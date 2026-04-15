import asyncio
from playwright.async_api import async_playwright


async def _scrape(awb_number: str) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        try:
            await page.goto("https://shreemaruti.com/track-shipment/", timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)

            # Fill tracking number and submit
            await page.fill("#home-awb", awb_number)
            await page.click("#home-trackbtn")

            # Wait for the results iframe to appear
            await page.wait_for_selector("#tracking-iframe", timeout=20000)
            await asyncio.sleep(4)  # let the iframe fully render

            iframe_el = await page.query_selector("#tracking-iframe")
            if not iframe_el:
                return {"error": "Tracking iframe not found", "awb": awb_number}

            frame = await iframe_el.content_frame()
            if not frame:
                return {"error": "Could not access iframe", "awb": awb_number}

            await frame.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(2)

            body_text = await frame.inner_text("body")
            return _parse(body_text, awb_number)

        except Exception as exc:
            return {"error": str(exc), "awb": awb_number}
        finally:
            await browser.close()


def _parse(content: str, awb_number: str) -> dict:
    lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    low = content.lower()

    # Determine status
    if "delivered" in low:
        status = "Delivered"
        is_delivered = True
    elif "out for delivery" in low:
        status = "Out for Delivery"
        is_delivered = False
    elif "in transit" in low:
        status = "In Transit"
        is_delivered = False
    elif "booked" in low or "picked up" in low:
        status = "Picked Up / Booked"
        is_delivered = False
    elif "arrived" in low:
        status = "Arrived at Hub"
        is_delivered = False
    else:
        status = lines[0] if lines else "Unknown"
        is_delivered = False

    # Heuristic event parsing
    keywords = ("delivered", "transit", "out for", "booked", "picked",
                 "arrived", "departed", "dispatch", "hub")
    events = []
    for i, line in enumerate(lines):
        if any(kw in line.lower() for kw in keywords):
            events.append({
                "status": line,
                "location": lines[i + 1] if i + 1 < len(lines) else None,
                "event_time": lines[i + 2] if i + 2 < len(lines) else None,
                "description": line,
            })

    current_location = events[0]["location"] if events else None

    return {
        "awb": awb_number,
        "current_status": status,
        "current_location": current_location,
        "is_delivered": is_delivered,
        "delivery_date": None,
        "events": events[:15],
        "raw_content": content,
    }


def scrape_shreemaruti(awb_number: str) -> dict:
    """Synchronous entry point."""
    return asyncio.run(_scrape(awb_number))
