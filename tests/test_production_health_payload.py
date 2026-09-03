from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_health_payload import build_health_payload, format_utc_timestamp  # noqa: E402


class ProductionHealthPayloadTests(unittest.TestCase):
    def test_builds_health_contract_from_explicit_inputs(self) -> None:
        generated_at = datetime(2026, 9, 3, 15, 0, tzinfo=timezone.utc)
        self.assertEqual(
            build_health_payload("abc123", generated_at),
            {
                "status": "ok",
                "service": "teacherflavius.com",
                "commit": "abc123",
                "generated_at": "2026-09-03T15:00:00Z",
            },
        )

    def test_normalizes_timestamp_to_utc(self) -> None:
        local = datetime(2026, 9, 3, 12, 0, tzinfo=timezone(timedelta(hours=-3)))
        self.assertEqual(format_utc_timestamp(local), "2026-09-03T15:00:00Z")


if __name__ == "__main__":
    unittest.main()
