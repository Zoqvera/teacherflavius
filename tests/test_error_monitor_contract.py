from __future__ import annotations

import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "error_monitor.js"


class ErrorMonitorContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_monitor_installation_is_idempotent(self) -> None:
        self.assertIn(
            'const INSTALL_FLAG = "__teacherFlaviusErrorMonitorInstalled";',
            self.source,
        )
        self.assertIn("if (window[INSTALL_FLAG]) return;", self.source)
        self.assertIn("window[INSTALL_FLAG] = true;", self.source)

    def test_auth_network_failures_are_not_auth_rejections(self) -> None:
        self.assertIn("function classifyNetworkFailure(url)", self.source)
        self.assertIn(
            'return requestType === "auth" ? "api" : requestType;',
            self.source,
        )
        self.assertIn(
            "event_type: classifyNetworkFailure(info.url)",
            self.source,
        )

    def test_cloudflare_beacon_failures_are_ignored(self) -> None:
        self.assertIn("function isIgnoredResource(target)", self.source)
        self.assertIn(
            'url.hostname === "static.cloudflareinsights.com"',
            self.source,
        )
        self.assertIn(
            'url.pathname.indexOf("/beacon.min.js") === 0',
            self.source,
        )
        self.assertIn("if (isIgnoredResource(target)) return;", self.source)


if __name__ == "__main__":
    unittest.main()
