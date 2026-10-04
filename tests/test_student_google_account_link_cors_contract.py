from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FUNCTION = ROOT / "supabase" / "functions" / "student-google-account-link" / "index.ts"


class StudentGoogleAccountLinkCorsContractTests(unittest.TestCase):
    def test_allows_site_and_android_webview_origins(self) -> None:
        source = FUNCTION.read_text(encoding="utf-8")

        self.assertIn('const browserOrigin = "https://teacherflavius.com";', source)
        self.assertIn('const androidAppOrigin = "https://localhost";', source)
        self.assertIn("const allowedOrigins = new Set([browserOrigin, androidAppOrigin]);", source)
        self.assertIn('headers["Access-Control-Allow-Origin"] = origin;', source)

    def test_rejects_unapproved_origins_and_keeps_options_handler(self) -> None:
        source = FUNCTION.read_text(encoding="utf-8")

        self.assertIn("if (!isAllowedOrigin(origin))", source)
        self.assertIn('if (req.method === "OPTIONS")', source)
        self.assertIn('"Access-Control-Allow-Methods": "POST, OPTIONS"', source)


if __name__ == "__main__":
    unittest.main()
