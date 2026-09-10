from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from health_endpoint_contract import validate_health  # noqa: E402


class HealthEndpointContractTests(unittest.TestCase):
    def test_accepts_expected_health_payload(self) -> None:
        validate_health({"status": "ok", "service": "teacherflavius.com"})

    def test_rejects_invalid_status(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid health status"):
            validate_health({"status": "error", "service": "teacherflavius.com"})

    def test_rejects_unexpected_service(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unexpected service identifier"):
            validate_health({"status": "ok", "service": "other-service"})


if __name__ == "__main__":
    unittest.main()
