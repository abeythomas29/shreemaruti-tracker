import httpx
import asyncio
from datetime import datetime, timezone

API_URL = "https://apis.delcaper.com/tracking/v2/{awb}"
HEADERS = {
    "Origin": "https://tracking.shreemaruti.com",
    "Referer": "https://tracking.shreemaruti.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
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

# Simple in-memory cache: {awb: (timestamp, result)}
_cache: dict = {}
CACHE_TTL_SECONDS = 300  # cache results for 5 minutes


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


def _parse(data: dict, awb_number: str) -> dict:
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


async def scrape_shreemaruti(awb_number: str) -> dict:
    # Return cached result if fresh
    now = datetime.now(timezone.utc).timestamp()
    if awb_number in _cache:
        cached_at, cached_result = _cache[awb_number]
        if now - cached_at < CACHE_TTL_SECONDS:
            return cached_result

    url = API_URL.format(awb=awb_number)

    # Retry up to 3 times with backoff on 429
    for attempt in range(3):
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.get(url, headers=HEADERS)
                if resp.status_code == 429:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)  # 1s, 2s
                        continue
                    return {"error": "Rate limited by tracking API. Please try again in a moment.", "awb": awb_number}
                resp.raise_for_status()
                data = resp.json()
                result = _parse(data, awb_number)
                _cache[awb_number] = (now, result)
                return result
            except httpx.HTTPStatusError as e:
                return {"error": f"API returned {e.response.status_code}", "awb": awb_number}
            except Exception as e:
                return {"error": str(e), "awb": awb_number}

    return {"error": "Failed after retries", "awb": awb_number}
