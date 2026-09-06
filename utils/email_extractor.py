import re

EMAIL_REGEX = re.compile(
    r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
)

PHONE_REGEX = re.compile(
    r'(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})(?:\s*(?:#|x\.?|ext\.?|extension)\s*(\d+))?'
)

def extract_emails(text: str) -> list[str]:
    """Extracts all valid email addresses from text, ignoring image file extensions."""
    if not text:
        return []
    matches = EMAIL_REGEX.findall(text)
    # Filter out common false positives like .png, .jpg, .webp
    invalid_exts = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.tiff')
    valid_emails = [
        email.lower().strip() 
        for email in matches 
        if not any(email.lower().endswith(ext) for ext in invalid_exts)
    ]
    return list(dict.fromkeys(valid_emails))

def extract_first_email(text: str) -> str:
    """Returns the first email found or an empty string."""
    emails = extract_emails(text)
    return emails[0] if emails else ""

def extract_phones(text: str) -> list[str]:
    """Extracts phone number strings from bio/text."""
    if not text:
        return []
    matches = PHONE_REGEX.findall(text)
    # Clean phone formats
    phones = []
    for m in matches:
        joined = "".join(m).strip()
        if len(re.sub(r'\D', '', joined)) >= 10:
            phones.append(joined)
    return list(dict.fromkeys(phones))
