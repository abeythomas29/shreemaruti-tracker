import httpx
import asyncio
import re
from datetime import datetime, timezone

# ── Courier registry ──────────────────────────────────────────────────────────
# Only couriers with confirmed free/public tracking endpoints (no API key required)
COURIERS = {
    "shreemaruti": "Shree Maruti",
    "india_post":  "India Post",
    "ekart":       "Ekart (Flipkart)",
    "shadowfax":   "Shadowfax",
    "gati":        "Gati KWE",
    "aramex":      "Aramex",
    "dtdc":        "DTDC Express",
}

# ── Common status map ─────────────────────────────────────────────────────────
STATUS_MAP = {
    "delivered":       ("Delivered",                    True),
    "out_for_delivery":("Out for Delivery",             False),
    "out for delivery":("Out for Delivery",             False),
    "inscanned_at_cp": ("Arrived at Delivery Point",    False),
    "outscan_to_cp":   ("Dispatched to Delivery Point", False),
    "inscan_at_hub":   ("Arrived at Hub",               False),
    "outscan_at_hub":  ("Departed from Hub",            False),
    "booked":          ("Booked / Picked Up",           False),
    "pickup_done":     ("Picked Up",                    False),
    "picked up":       ("Picked Up",                    False),
    "in_transit":      ("In Transit",                   False),
    "in transit":      ("In Transit",                   False),
    "rto":             ("Return to Origin",             False),
    "undelivered":     ("Undelivered",                  False),
    "shipment created":("Shipment Created",             False),
    "manifested":      ("Manifested",                   False),
}

# ── In-memory cache ───────────────────────────────────────────────────────────
_cache: dict = {}
CACHE_TTL = 300  # 5 minutes


def _cached(key: str):
    now = datetime.now(timezone.utc).timestamp()
    if key in _cache:
        ts, val = _cache[key]
        if now - ts < CACHE_TTL:
            return val
    return None


def _store(key: str, val: dict):
    _cache[key] = (datetime.now(timezone.utc).timestamp(), val)


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


# ── AWB auto-detection ────────────────────────────────────────────────────────
def detect_courier(awb: str) -> str:
    """
    Detect courier from AWB format. Each courier uses a distinctive pattern:
      India Post  : 2 letters + 8 digits + IN  (e.g. EE123456789IN)
      Ekart       : starts with FMPP / AWBF / FBF / HYF / FKMP
      Shadowfax   : starts with SFX or SFXIND
      Gati        : G or GA prefix + 6-10 digits (e.g. G1234567)
      Aramex      : starts with 1 or 6, exactly 9-12 digits
      Shree Maruti: exactly 14 digits
      (fallback)  : shreemaruti
    """
    awb = awb.strip()
    u = awb.upper()

    # India Post: 2 letters + 8 digits + "IN"
    if re.match(r'^[A-Z]{2}\d{8}IN$', u):
        return "india_post"
    # Ekart / Flipkart logistics
    if u.startswith(("FMPP", "AWBF", "FBF", "HYF", "FKMP")):
        return "ekart"
    # Shadowfax
    if u.startswith(("SFX", "SFXIND")):
        return "shadowfax"
    # Gati KWE
    if re.match(r'^G[A-Z]?\d{6,10}$', u):
        return "gati"
    # Aramex: starts with 1 or 6, 9-12 digits
    if re.match(r'^[16]\d{8,11}$', awb):
        return "aramex"
    # DTDC: one letter + 7-9 digits (e.g. B34234010)
    if re.match(r'^[A-Z]\d{7,9}$', u):
        return "dtdc"
    # Shree Maruti: exactly 14 digits
    if re.match(r'^\d{14}$', awb):
        return "shreemaruti"
    # Default fallback
    return "shreemaruti"


# ── Shree Maruti (Delcaper API) ───────────────────────────────────────────────
_DELCAPER_URL = "https://apis.delcaper.com/tracking/v2/{awb}"
_DELCAPER_HEADERS = {
    "Origin":          "https://tracking.shreemaruti.com",
    "Referer":         "https://tracking.shreemaruti.com/",
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_delcaper(data: dict, awb: str) -> dict:
    statuses = data.get("statuses", [])
    order    = data.get("orderInformation", {})
    if not statuses:
        return {"awb": awb, "current_status": "No tracking info yet",
                "current_location": None, "is_delivered": False,
                "delivery_date": None, "events": []}
    latest          = statuses[0]
    raw_status      = latest.get("status", "")
    friendly, is_d  = _friendly_status(raw_status)
    current_loc     = latest.get("location") or order.get("destinationLocation", {}).get("city")
    events = []
    for s in statuses:
        raw   = s.get("status", "")
        label, _ = _friendly_status(raw)
        ts    = s.get("statusTimestamp")
        events.append({"status": label,
                        "description": s.get("subcategory") or s.get("event") or label,
                        "location":    s.get("location"),
                        "event_time":  _fmt_time(ts) if ts else None})
    dest = order.get("destinationLocation", {})
    src  = order.get("sourceLocation", {})
    return {
        "awb":              awb,
        "current_status":   friendly,
        "current_location": current_loc,
        "is_delivered":     is_d,
        "delivery_date":    _fmt_time(statuses[0].get("statusTimestamp")) if is_d else None,
        "events":           events[:15],
        "origin":           f"{src.get('city','')}, {src.get('state','')}".strip(", "),
        "destination":      f"{dest.get('city','')}, {dest.get('state','')}".strip(", "),
        "receiver":         order.get("receiverDetails", {}).get("receiver_name", ""),
    }


async def track_shreemaruti(awb: str) -> dict:
    for attempt in range(3):
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.get(_DELCAPER_URL.format(awb=awb), headers=_DELCAPER_HEADERS)
                if resp.status_code == 429:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return {"error": "Rate limited by tracking API. Please try again.", "awb": awb}
                resp.raise_for_status()
                return _parse_delcaper(resp.json(), awb)
            except httpx.HTTPStatusError as e:
                return {"error": f"API returned {e.response.status_code}", "awb": awb}
            except Exception as e:
                return {"error": str(e), "awb": awb}
    return {"error": "Failed after retries", "awb": awb}


# ── Delhivery ─────────────────────────────────────────────────────────────────
async def track_delhivery(awb: str) -> dict:
    url = f"https://dlvryclient.delhivery.com/v1/packages/json/?waybill={awb}&token="
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data  = resp.json()
        ships = data.get("ShipmentData", [])
        if not ships:
            return {"awb": awb, "current_status": "No tracking data found",
                    "is_delivered": False, "events": []}
        s       = ships[0].get("Shipment", {})
        status  = s.get("Status", {})
        scans   = s.get("Scans", [])
        current = status.get("Status", "Unknown")
        is_d    = "delivered" in current.lower()
        events  = []
        for sc in scans:
            sd = sc.get("ScanDetail", {})
            events.append({
                "status":      sd.get("Instructions", ""),
                "description": sd.get("Reason", ""),
                "location":    sd.get("City", "") or sd.get("ScannedLocation", ""),
                "event_time":  sd.get("ScanDateTime", ""),
            })
        return {
            "awb":              awb,
            "current_status":   current,
            "current_location": status.get("StatusLocation", ""),
            "is_delivered":     is_d,
            "delivery_date":    status.get("StatusDateTime") if is_d else None,
            "events":           events[:15],
            "origin":           s.get("Origin", ""),
            "destination":      s.get("Destination", ""),
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Delhivery returned {e.response.status_code}. An API key may be required.", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── India Post ────────────────────────────────────────────────────────────────
async def track_india_post(awb: str) -> dict:
    awb = awb.upper().strip()
    url = f"https://api.indiapost.gov.in/ems/emsinterface/getTracking?consignment_id={awb}"
    headers = {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":          "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        # Response can be wrapped under 'consignment' or directly
        consignment = data.get("consignment") or data
        raw_events  = (consignment.get("events") or
                       consignment.get("Tracking") or
                       data.get("Tracking") or [])
        events = []
        for ev in raw_events:
            events.append({
                "status":      ev.get("action") or ev.get("description", ""),
                "description": ev.get("description", ""),
                "location":    ev.get("officeName") or ev.get("location", ""),
                "event_time":  f"{ev.get('date','')} {ev.get('time','')}".strip(),
            })
        latest_status = events[0]["status"] if events else "No info available"
        is_d = "delivered" in latest_status.lower()
        return {
            "awb":              awb,
            "current_status":   latest_status,
            "current_location": events[0].get("location") if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"India Post API returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Ekart (Flipkart Logistics) ────────────────────────────────────────────────
async def track_ekart(awb: str) -> dict:
    url = f"https://ekartlogistics.com/shipmenttracking/{awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://ekartlogistics.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        checkpoints = (data.get("checkpoints") or data.get("Checkpoints") or
                       data.get("trackingDetails") or [])
        current = (data.get("status") or data.get("Status") or
                   (checkpoints[0].get("activity") if checkpoints else "Unknown"))
        is_d    = "delivered" in str(current).lower()
        events  = []
        for cp in checkpoints:
            events.append({
                "status":      cp.get("activity") or cp.get("status", ""),
                "description": cp.get("message") or cp.get("description", ""),
                "location":    cp.get("city") or cp.get("location", ""),
                "event_time":  cp.get("date") or cp.get("timestamp", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Ekart returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── DTDC ──────────────────────────────────────────────────────────────────────
async def track_dtdc(awb: str) -> dict:
    # DTDC CTBS public endpoint
    url = f"https://ctbs.dtdc.com/ctbs-service/resource/v4/trackingDetails/query?consignee_code=&tracking_num={awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://www.dtdc.in/",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        # DTDC wraps results in a list
        results = data if isinstance(data, list) else data.get("trackingDetails", [])
        if not results:
            return {"awb": awb, "current_status": "No tracking data found",
                    "is_delivered": False, "events": []}
        first  = results[0]
        status = first.get("shipmentStatus") or first.get("status", "Unknown")
        is_d   = "delivered" in str(status).lower()
        scans  = first.get("scans") or first.get("trackingHistory") or []
        events = []
        for sc in scans:
            events.append({
                "status":      sc.get("status") or sc.get("scanType", ""),
                "description": sc.get("instructions") or sc.get("remarks", ""),
                "location":    sc.get("city") or sc.get("location", ""),
                "event_time":  sc.get("scanDateTime") or sc.get("date", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(status),
            "current_location": first.get("destination", ""),
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"DTDC returned {e.response.status_code}. An API key may be required.", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── XpressBees ───────────────────────────────────────────────────────────────
async def track_xpressbees(awb: str) -> dict:
    url = f"https://shipment.xpressbees.com/api/shipments2/track/{awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        payload  = data.get("data") or data
        scans    = payload.get("scans") or payload.get("trackingHistory") or []
        current  = payload.get("last_status") or payload.get("status") or "Unknown"
        is_d     = "delivered" in str(current).lower()
        events   = []
        for sc in scans:
            events.append({
                "status":      sc.get("status", ""),
                "description": sc.get("activity") or sc.get("remarks", ""),
                "location":    sc.get("location", ""),
                "event_time":  sc.get("date_time") or sc.get("timestamp", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"XpressBees returned {e.response.status_code}. An API key may be required.", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── BlueDart ─────────────────────────────────────────────────────────────────
async def track_bluedart(awb: str) -> dict:
    # BlueDart REST API endpoint (requires registration but returns JSON)
    url = "https://apigateway.bluedart.com/in/transportation/track/v1/shipments"
    headers = {
        "User-Agent":   "Mozilla/5.0",
        "Accept":       "application/json",
        "JWTToken":     "",   # Requires token from developer.bluedart.com
        "loginid":      "",
    }
    # Without credentials, BlueDart requires API registration.
    # Return a helpful message rather than a raw auth error.
    return {
        "error": (
            "BlueDart tracking requires a free API key. "
            "Register at developer.bluedart.com and add BLUEDART_API_KEY to your .env."
        ),
        "awb": awb,
    }


# ── Shadowfax ─────────────────────────────────────────────────────────────────
async def track_shadowfax(awb: str) -> dict:
    """Shadowfax public tracking endpoint (no auth required)."""
    url = f"https://external.shadowfax.in/api/orders/track/?order_id={awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://tracker.shadowfax.in/",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        # Shadowfax wraps data under "data" or top-level
        payload  = data.get("data") or data
        statuses = payload.get("status_details") or payload.get("trackingDetails") or []
        current  = (payload.get("current_status") or payload.get("status") or
                    (statuses[0].get("status") if statuses else "Unknown"))
        is_d     = "delivered" in str(current).lower()
        events   = []
        for ev in statuses:
            events.append({
                "status":      ev.get("status", ""),
                "description": ev.get("remarks") or ev.get("description", ""),
                "location":    ev.get("location") or ev.get("city", ""),
                "event_time":  ev.get("timestamp") or ev.get("created_at", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": payload.get("city") or (events[0]["location"] if events else None),
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Shadowfax returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Gati KWE ─────────────────────────────────────────────────────────────────
async def track_gati(awb: str) -> dict:
    """Gati public tracking via their web API."""
    url = f"https://www.gati.com/GatiWeb/TrackShipmentAction?docketNumber={awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer":    "https://www.gati.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        # Gati returns tracking data under various keys
        shipment = data.get("shipmentDetails") or data.get("docketDetails") or data
        if isinstance(shipment, list):
            shipment = shipment[0] if shipment else {}
        history = (data.get("trackingHistory") or data.get("movementHistory") or
                   shipment.get("history") or [])
        current = (shipment.get("currentStatus") or shipment.get("status") or
                   (history[0].get("status") if history else "Unknown"))
        is_d    = "delivered" in str(current).lower()
        events  = []
        for ev in history:
            events.append({
                "status":      ev.get("status") or ev.get("activity", ""),
                "description": ev.get("remarks") or ev.get("description", ""),
                "location":    ev.get("location") or ev.get("city", ""),
                "event_time":  ev.get("date") or ev.get("timestamp", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": shipment.get("destination") or (events[0]["location"] if events else None),
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
            "origin":           shipment.get("origin", ""),
            "destination":      shipment.get("destination", ""),
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Gati returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Smartr Logistics ───────────────────────────────────────────────────────────
async def track_smartr(awb: str) -> dict:
    """Smartr Logistics public tracking (no API key required)."""
    url = f"https://www.smartrlogistics.com/api/track/{awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://www.smartrlogistics.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        payload  = data.get("data") or data
        history  = payload.get("trackingHistory") or payload.get("events") or []
        current  = payload.get("currentStatus") or payload.get("status") or \
                   (history[0].get("status") if history else "Unknown")
        is_d     = "delivered" in str(current).lower()
        events   = []
        for ev in history:
            events.append({
                "status":      ev.get("status", ""),
                "description": ev.get("remarks") or ev.get("description", ""),
                "location":    ev.get("location") or ev.get("city", ""),
                "event_time":  ev.get("timestamp") or ev.get("date", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Smartr returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Amazon Logistics India ────────────────────────────────────────────────────
async def track_amazon(awb: str) -> dict:
    """Amazon Logistics public tracking page scrape."""
    url = f"https://track.amazon.in/tracking/{awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    # Amazon tracking is web-only (no public JSON API); attempt API endpoint
    api_url = f"https://track.amazon.in/api/tracker/{awb}"
    api_headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept":     "application/json",
        "Referer":    f"https://track.amazon.in/tracking/{awb}",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(api_url, headers=api_headers)
            resp.raise_for_status()
            data = resp.json()
        events_raw = data.get("trackingEvents") or data.get("events") or []
        current    = data.get("packageStatus") or data.get("status") or \
                     (events_raw[0].get("statusCode") if events_raw else "Unknown")
        is_d       = "delivered" in str(current).lower()
        events     = []
        for ev in events_raw:
            events.append({
                "status":      ev.get("status") or ev.get("statusCode", ""),
                "description": ev.get("description", ""),
                "location":    ev.get("city") or ev.get("location", ""),
                "event_time":  ev.get("eventTime") or ev.get("date", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Amazon tracking returned {e.response.status_code}. "
                         "Try opening track.amazon.in manually.", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Aramex ────────────────────────────────────────────────────────────────────
async def track_aramex(awb: str) -> dict:
    """Aramex public shipment tracker (JSON endpoint used by their widget)."""
    url = "https://www.aramex.com/us/en/track/track-results-new"
    params = {"ShipmentNumber": awb}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://www.aramex.com/us/en/track",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        shipment = (data.get("ShipmentTrackingNumber") or
                    (data.get("Shipments") or [{}])[0])
        history  = shipment.get("TrackingActivities") or shipment.get("events") or []
        current  = shipment.get("UpdateDescription") or shipment.get("status") or \
                   (history[0].get("UpdateDescription") if history else "Unknown")
        is_d     = "delivered" in str(current).lower()
        events   = []
        for ev in history:
            events.append({
                "status":      ev.get("UpdateDescription") or ev.get("ActivityDescription", ""),
                "description": ev.get("UpdateDescription", ""),
                "location":    ev.get("UpdateLocation") or ev.get("ActivityLocation", {}).get("City", ""),
                "event_time":  ev.get("UpdateDateTime") or ev.get("ActivityDateTime", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Aramex returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Rivigo / Porter ───────────────────────────────────────────────────────────
async def track_rivigo(awb: str) -> dict:
    """Rivigo / Porter public tracking (no auth required)."""
    # Try Porter first (uses Rivigo infrastructure)
    url = f"https://tracking.rivigo.com/tracking/{awb}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://tracking.rivigo.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        payload  = data.get("data") or data
        history  = payload.get("trackingHistory") or payload.get("events") or []
        current  = payload.get("currentStatus") or payload.get("status") or \
                   (history[0].get("status") if history else "Unknown")
        is_d     = "delivered" in str(current).lower()
        events   = []
        for ev in history:
            events.append({
                "status":      ev.get("status", ""),
                "description": ev.get("remarks") or ev.get("description", ""),
                "location":    ev.get("location") or ev.get("city", ""),
                "event_time":  ev.get("timestamp") or ev.get("date", ""),
            })
        return {
            "awb":              awb,
            "current_status":   str(current),
            "current_location": events[0]["location"] if events else None,
            "is_delivered":     is_d,
            "delivery_date":    events[0]["event_time"] if is_d and events else None,
            "events":           events[:15],
        }
    except httpx.HTTPStatusError as e:
        return {"error": f"Rivigo returned {e.response.status_code}", "awb": awb}
    except Exception as e:
        return {"error": str(e), "awb": awb}


# ── Unified entry point ───────────────────────────────────────────────────────
_HANDLERS = {
    "shreemaruti": track_shreemaruti,
    "india_post":  track_india_post,
    "ekart":       track_ekart,
    "shadowfax":   track_shadowfax,
    "gati":        track_gati,
    "aramex":      track_aramex,
    "dtdc":        track_dtdc,
}


async def track_shipment(awb: str, courier: str = "auto") -> dict:
    awb = awb.strip()
    if not courier or courier == "auto":
        courier = detect_courier(awb)

    cache_key = f"{courier}:{awb}"
    cached = _cached(cache_key)
    if cached:
        return {**cached, "courier": courier}

    fn     = _HANDLERS.get(courier, track_shreemaruti)
    result = await fn(awb)

    if "error" not in result:
        _store(cache_key, result)

    return {**result, "courier": courier}


# Backward-compat alias used by old main.py imports
async def scrape_shreemaruti(awb: str) -> dict:
    return await track_shreemaruti(awb)
