import tempfile
import unittest
from pathlib import Path

from scripts.check_performance_budgets import (
    Budget,
    Metrics,
    budget_failures,
    measure_page,
)


class PerformanceBudgetTests(unittest.TestCase):
    def test_measure_page_counts_only_eager_local_media(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "styles.css").write_text(
                ".hero{background:url('/assets/hero.jpg')} .icon{background:url(data:image/svg+xml,x)}",
                encoding="utf-8",
            )
            (root / "app.js").write_text("console.log('ok')", encoding="utf-8")
            (root / "assets" / "hero.jpg").write_bytes(b"x" * 20)
            (root / "assets" / "eager.jpg").write_bytes(b"x" * 30)
            (root / "assets" / "lazy.jpg").write_bytes(b"x" * 40)
            (root / "index.html").write_text(
                """<!doctype html><link rel='stylesheet' href='/styles.css'>
                <img src='/assets/eager.jpg'>
                <img src='/assets/lazy.jpg' loading='lazy'>
                <script src='/app.js'></script>""",
                encoding="utf-8",
            )

            metrics = measure_page(root, "/")

            self.assertEqual(metrics.css_bytes, (root / "styles.css").stat().st_size)
            self.assertEqual(metrics.javascript_bytes, (root / "app.js").stat().st_size)
            self.assertEqual(metrics.eager_media_bytes, 50)
            self.assertEqual(metrics.direct_requests, 4)

    def test_budget_failures_report_only_exceeded_dimensions(self):
        metrics = Metrics(
            html_bytes=101,
            css_bytes=80,
            javascript_bytes=70,
            eager_media_bytes=60,
            direct_requests=5,
        )
        budget = Budget(
            html_kib=0,
            css_kib=1,
            javascript_kib=1,
            eager_media_kib=1,
            direct_requests=4,
        )

        failures = budget_failures("/", metrics, budget)

        self.assertEqual(len(failures), 2)
        self.assertIn("HTML", failures[0])
        self.assertIn("direct requests", failures[1])


if __name__ == "__main__":
    unittest.main()
