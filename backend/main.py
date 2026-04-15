import os, shutil, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import (
    FastAPI, Depends, HTTPException, status,
    UploadFile, File, Form, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models, schemas, auth, payments
from database import engine, get_db, Base, run_migrations
from vision import extract_awb_from_image
from scraper import track_shipment, COURIERS

# ── DB init ──────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)
run_migrations()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Courier Track AI API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://shreemaruti-tracker.vercel.app",
        "https://couriertrack.ai",
        os.getenv("FRONTEND_URL", ""),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=schemas.Token)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == user_in.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(
        email=user_in.email,
        full_name=user_in.full_name,
        hashed_password=auth.hash_password(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@app.post("/auth/login", response_model=schemas.Token)
def login(user_in: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if not user or not auth.verify_password(user_in.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@app.get("/auth/me", response_model=schemas.UserResponse)
def me(current_user: models.User = Depends(auth.get_current_user)):
    return {**current_user.__dict__, "has_api_key": bool(current_user.openai_api_key)}


# ── Settings ──────────────────────────────────────────────────────────────────

@app.put("/settings/api-key")
def update_api_key(
    body: schemas.UpdateAPIKey,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    current_user.openai_api_key = body.api_key.strip()
    db.commit()
    return {"message": "API key saved"}


@app.delete("/settings/api-key")
def delete_api_key(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    current_user.openai_api_key = None
    db.commit()
    return {"message": "API key removed"}


# ── Payments ──────────────────────────────────────────────────────────────────

@app.post("/payments/checkout", response_model=schemas.CheckoutResponse)
def checkout(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.subscription_status == "active":
        raise HTTPException(status_code=400, detail="Already subscribed")
    url = payments.create_checkout_session(current_user.email, current_user.id)
    return {"checkout_url": url}


@app.post("/payments/portal", response_model=schemas.CheckoutResponse)
def billing_portal(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not current_user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found")
    url = payments.create_portal_session(current_user.stripe_customer_id)
    return {"checkout_url": url}


@app.post("/payments/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    event = payments.handle_webhook_event(payload, sig)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = int(session["metadata"].get("user_id", 0))
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            user.subscription_status = "active"
            user.stripe_customer_id = session.get("customer")
            user.stripe_subscription_id = session.get("subscription")
            db.commit()

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub = event["data"]["object"]
        user = db.query(models.User).filter(
            models.User.stripe_subscription_id == sub["id"]
        ).first()
        if user:
            user.subscription_status = "canceled"
            db.commit()

    elif event["type"] == "customer.subscription.updated":
        sub = event["data"]["object"]
        user = db.query(models.User).filter(
            models.User.stripe_subscription_id == sub["id"]
        ).first()
        if user:
            user.subscription_status = "active" if sub["status"] == "active" else "canceled"
            db.commit()

    return {"received": True}


# ── Public tracking (5 free searches/day per IP) ─────────────────────────────

DAILY_FREE_LIMIT = 5

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host

def _check_and_increment_quota(db: Session, ip: str) -> int:
    """Returns remaining searches after this one. Raises 429 if limit hit."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    row = db.query(models.PublicSearchQuota).filter_by(ip_address=ip, date=today).first()
    if not row:
        row = models.PublicSearchQuota(ip_address=ip, date=today, count=0)
        db.add(row)
    if row.count >= DAILY_FREE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit of {DAILY_FREE_LIMIT} free searches reached. Sign up for unlimited tracking."
        )
    row.count += 1
    db.commit()
    return DAILY_FREE_LIMIT - row.count


@app.get("/couriers")
def list_couriers():
    """Return all supported couriers."""
    return [{"id": k, "name": v} for k, v in COURIERS.items()]


@app.post("/track/public")
async def public_track(
    request: Request,
    image: Optional[UploadFile] = File(None),
    awb_number: Optional[str] = Form(None),
    courier: Optional[str] = Form("auto"),
    db: Session = Depends(get_db),
):
    """Track by AWB or image — 5 free searches/day per IP, results not saved."""
    ip = _get_client_ip(request)
    remaining = _check_and_increment_quota(db, ip)

    if awb_number:
        final_awb = awb_number.strip()
    elif image:
        platform_key = os.getenv("PLATFORM_OPENAI_API_KEY")
        if not platform_key:
            raise HTTPException(status_code=402, detail="Image scanning requires an account. Please sign up.")
        ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
        filename = f"{uuid.uuid4()}.{ext}"
        filepath = UPLOAD_DIR / filename
        with filepath.open("wb") as f:
            shutil.copyfileobj(image.file, f)
        result = extract_awb_from_image(str(filepath), platform_key)
        filepath.unlink(missing_ok=True)
        if not result.get("awb"):
            raise HTTPException(status_code=422, detail="Could not extract AWB from image. Try entering it manually.")
        final_awb = result["awb"]
    else:
        raise HTTPException(status_code=400, detail="Provide an image or AWB number")

    tracking_data = await track_shipment(final_awb, courier or "auto")
    if "error" in tracking_data and not tracking_data.get("current_status"):
        raise HTTPException(status_code=502, detail=f"Could not fetch tracking: {tracking_data['error']}")

    tracking_data["searches_remaining"] = remaining
    return tracking_data


# ── Authenticated tracking (saves to history) ─────────────────────────────────

def _get_api_key(user: models.User) -> str:
    """All logged-in users can use AI — own key takes priority, else platform key."""
    if user.openai_api_key:
        return user.openai_api_key
    return os.getenv("PLATFORM_OPENAI_API_KEY", "")


@app.post("/scan", response_model=schemas.ScanOut)
async def scan_receipt(
    image: Optional[UploadFile] = File(None),
    awb_number: Optional[str] = Form(None),
    courier: Optional[str] = Form("auto"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # ── Step 1: Resolve AWB ───────────────────────────────────────────────────
    filename = None
    if awb_number:
        final_awb = awb_number.strip()
    elif image:
        ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
        filename = f"{uuid.uuid4()}.{ext}"
        filepath = UPLOAD_DIR / filename
        with filepath.open("wb") as f:
            shutil.copyfileobj(image.file, f)

        result = extract_awb_from_image(str(filepath), _get_api_key(current_user))
        if not result.get("awb"):
            raise HTTPException(status_code=422, detail="Could not extract AWB from image")
        final_awb = result["awb"]
    else:
        raise HTTPException(status_code=400, detail="Provide an image or AWB number")

    # ── Step 2: Track shipment ────────────────────────────────────────────────
    tracking_data = await track_shipment(final_awb, courier or "auto")
    resolved_courier = tracking_data.get("courier", "shreemaruti")

    if "error" in tracking_data and not tracking_data.get("current_status"):
        raise HTTPException(status_code=502, detail=f"Tracking failed: {tracking_data['error']}")

    # ── Step 3: Save to DB ────────────────────────────────────────────────────
    scan = models.Scan(
        user_id=current_user.id,
        awb_number=final_awb,
        courier=resolved_courier,
        image_filename=filename,
        current_status=tracking_data.get("current_status"),
        current_location=tracking_data.get("current_location"),
        is_delivered=tracking_data.get("is_delivered", False),
        delivery_date=tracking_data.get("delivery_date"),
        last_checked=datetime.now(timezone.utc),
    )
    db.add(scan)
    db.flush()

    for ev in tracking_data.get("events", []):
        db.add(models.TrackingEvent(
            scan_id=scan.id,
            status=ev.get("status", ""),
            location=ev.get("location"),
            description=ev.get("description"),
            event_time=ev.get("event_time"),
        ))

    db.commit()
    db.refresh(scan)
    return scan


@app.get("/scan/{awb}", response_model=schemas.ScanOut)
async def refresh_tracking(
    awb: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Re-fetch live status for an existing AWB."""
    scan = (
        db.query(models.Scan)
        .filter(models.Scan.awb_number == awb, models.Scan.user_id == current_user.id)
        .order_by(models.Scan.created_at.desc())
        .first()
    )
    if not scan:
        raise HTTPException(status_code=404, detail="AWB not found in your history")

    tracking_data = await track_shipment(awb, scan.courier or "auto")

    scan.current_status = tracking_data.get("current_status", scan.current_status)
    scan.current_location = tracking_data.get("current_location", scan.current_location)
    scan.is_delivered = tracking_data.get("is_delivered", scan.is_delivered)
    scan.last_checked = datetime.now(timezone.utc)

    # Add new events
    for ev in tracking_data.get("events", []):
        db.add(models.TrackingEvent(
            scan_id=scan.id,
            status=ev.get("status", ""),
            location=ev.get("location"),
            description=ev.get("description"),
            event_time=ev.get("event_time"),
        ))

    db.commit()
    db.refresh(scan)
    return scan


# ── History ───────────────────────────────────────────────────────────────────

@app.get("/history", response_model=list[schemas.ScanOut])
def history(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Scan)
        .filter(models.Scan.user_id == current_user.id)
        .order_by(models.Scan.created_at.desc())
        .all()
    )


@app.get("/history/last-delivery", response_model=Optional[schemas.ScanOut])
def last_delivery(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Scan)
        .filter(
            models.Scan.user_id == current_user.id,
            models.Scan.is_delivered == True,
        )
        .order_by(models.Scan.created_at.desc())
        .first()
    )
