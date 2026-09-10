#!/usr/bin/env python3
from __future__ import annotations

import re

STANDARD_WHATSAPP_URL = "https://wa.me/5534998349756?text=Ol%C3%A1%2C%20Teacher%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conversar%20sobre%20as%20aulas%20de%20ingl%C3%AAs."
WA_ME_RE = re.compile(
    r'https://wa\.me/5534998349756(?:\?[^"\']*)?',
    re.IGNORECASE,
)
API_WHATSAPP_RE = re.compile(
    r'https://api\.whatsapp\.com/send\?[^"\']*phone=5534998349756[^"\']*',
    re.IGNORECASE,
)


def standardize_whatsapp_links(html: str) -> str:
    standardized = WA_ME_RE.sub(STANDARD_WHATSAPP_URL, html)
    return API_WHATSAPP_RE.sub(STANDARD_WHATSAPP_URL, standardized)
