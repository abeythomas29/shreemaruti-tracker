import base64, os, json, re
from openai import OpenAI


def extract_awb_from_image(image_path: str, user_api_key: str = None) -> dict:
    """
    Use GPT-4o vision to extract the AWB / consignment number from a receipt image.
    Falls back to platform key if user has no key (paid subscriber).
    """
    api_key = user_api_key or os.getenv("PLATFORM_OPENAI_API_KEY")
    if not api_key:
        raise ValueError("No OpenAI API key available")

    client = OpenAI(api_key=api_key)

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    ext = image_path.lower().rsplit(".", 1)[-1]
    media_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                  "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media_type};base64,{image_data}"}
                },
                {
                    "type": "text",
                    "text": (
                        "This is a courier / shipment receipt image. "
                        "Find the AWB number, Consignment Number, Tracking Number, or Docket Number "
                        "(also labelled C.N. No., CN No., AWB No., Waybill No., or similar). "
                        "It is usually a long alphanumeric string printed prominently on the label.\n\n"
                        "Also identify the courier company from logos, branding, or text on the label. "
                        "Use one of these IDs if you recognise it: shreemaruti, india_post, ekart, "
                        "shadowfax, gati, aramex, dtdc, delhivery, bluedart, xpressbees. "
                        "If unknown, set courier to null.\n\n"
                        "Return ONLY valid JSON:\n"
                        '{"awb": "THE_NUMBER", "courier": "COURIER_ID_OR_NULL", "confidence": "high|medium|low"}\n\n'
                        'If AWB not found: {"awb": null, "courier": null, "confidence": "low"}'
                    )
                }
            ]
        }],
        max_tokens=200,
    )

    text = response.choices[0].message.content.strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Fallback: try to pull any long digit string from the response
    numbers = re.findall(r'\b\d{10,}\b', text)
    if numbers:
        return {"awb": numbers[0], "confidence": "medium"}

    return {"awb": None, "confidence": "low"}
