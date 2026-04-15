import httpx
from datetime import datetime, timezone

API_URL = "https://apis.delcaper.com/tracking/v2/{awb}"
HEADERS = {
    "Origin": "https://tracking.shreemaruti.com",
    "Referer": "https://tracking.shreemaruti.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

STATUS_MAP = {
    "delivered": ("Delivered", True),
    "out_for_delivery": ("Out for Delivery", False),
    "inscanned_at_cp": ("Arrived at Delivery Point", False),
    "outscan_to_cp": ("Dispatched to Delivery Point", False),
    "inscan_at_hub": ("Arrived at Hub", False),
    "outscan_at_hub": ("Departed from Hub", False),
    "booked": ("Booked / Picked Up", False),
    "pickup_done": ("Picked Up", False),
    "in_transit": ("In Transit", False),
    "rto": ("Return to Origin", False),
    "undelivered": ("Undelivered", False),
}


def _friendly_status(raw: str):
    key = raw.lower()
    for k, v in STATUS_MAP.items():
        if k in key:
            return v
    return (raw.replace("_", " ").title(), False)


def _fmt_time(ts_ms) -> str:
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).strftime("%d/%m/%Y, %I:%M:%S %p")
    except Exception:
        return str(ts_ms)


async def scrape_shreemaruti(awb_number: str) -> dict:
    url = API_URL.format(awb=awb_number)
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.get(url, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            return {"error": f"API returned {e.response.status_code}", "awb": awb_number}
        except Exception as e:
            return {"error": str(e), "awb": awb_number}

    statuses = data.get("statuses", [])
    order = data.get("orderInformation", {})

    if not statuses:
        return {
            "awb": awb_number,
            "current_status": "No tracking info yet",
            "current_location": None,
            "is_delivered": False,
            "delivery_date": None,
            "events": [],
        }

    # Latest status is first
    latest = statuses[0]
    raw_status = latest.get("status", "")
    friendly, is_delivered = _friendly_status(raw_status)
    current_location = latest.get("location") or order.get("destinationLocation", {}).get("city")

    events = []
    for s in statuses:
        raw = s.get("status", "")
        label, _ = _friendly_status(raw)
        ts = s.get("statusTimestamp")
        events.append({
            "status": label,
            "description": s.get("subcategory") or s.get("event") or label,
            "location": s.get("location"),
            "event_time": _fmt_time(ts) if ts else None,
        })

    dest = order.get("destinationLocation", {})
    src = order.get("sourceLocation", {})

    return {
        "awb": awb_number,
        "current_status": friendly,
        "current_location": current_location,
        "is_delivered": is_delivered,
        "delivery_date": _fmt_time(statuses[0].get("statusTimestamp")) if is_delivered else None,
        "events": events[:15],
        "origin": f"{src.get('city', '')}, {src.get('state', '')}".strip(", "),
        "destination": f"{dest.get('city', '')}, {dest.get('state', '')}".strip(", "),
        "receiver": order.get("receiverDetails", {}).get("receiver_name", ""),
    }
