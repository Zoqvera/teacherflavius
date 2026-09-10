from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_whatsapp_links import STANDARD_WHATSAPP_URL, standardize_whatsapp_links  # noqa: E402


class StaticWhatsappLinksTests(unittest.TestCase):
    def test_standardizes_wa_me_link(self) -> None:
        html = '<a href="https://wa.me/5534998349756?text=old">WhatsApp</a>'
        transformed = standardize_whatsapp_links(html)
        self.assertIn(STANDARD_WHATSAPP_URL, transformed)
        self.assertNotIn("text=old", transformed)

    def test_standardizes_api_whatsapp_link(self) -> None:
        html = '<a href="https://api.whatsapp.com/send?phone=5534998349756&text=old">WhatsApp</a>'
        transformed = standardize_whatsapp_links(html)
        self.assertIn(STANDARD_WHATSAPP_URL, transformed)
        self.assertNotIn("api.whatsapp.com", transformed)

    def test_preserves_unrelated_links(self) -> None:
        html = '<a href="https://example.com">Example</a>'
        self.assertEqual(standardize_whatsapp_links(html), html)


if __name__ == "__main__":
    unittest.main()
