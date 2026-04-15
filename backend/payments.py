import stripe, os
from fastapi import HTTPException

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


def create_checkout_session(user_email: str, user_id: int) -> str:
    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{"price": PRICE_ID, "quantity": 1}],
            mode="subscription",
            success_url=f"{FRONTEND_URL}/dashboard?subscription=success",
            cancel_url=f"{FRONTEND_URL}/settings?subscription=canceled",
            customer_email=user_email,
            metadata={"user_id": str(user_id)},
        )
        return session.url
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


def create_portal_session(stripe_customer_id: str) -> str:
    try:
        session = stripe.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=f"{FRONTEND_URL}/settings",
        )
        return session.url
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


def handle_webhook_event(payload: bytes, sig_header: str) -> dict:
    try:
        return stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
