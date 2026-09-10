import unittest

from scripts.check_lighthouse_guardrails import (
    LighthouseMetrics,
    guardrail_failures,
    median_metrics,
    representative_index,
)


class LighthouseGuardrailTests(unittest.TestCase):
    def test_uses_median_to_absorb_single_slow_runner(self):
        samples = [
            LighthouseMetrics(0.85, 3845, 0.03, 30),
            LighthouseMetrics(0.80, 4644, 0.005, 73),
            LighthouseMetrics(0.83, 3920, 0.02, 55),
        ]

        aggregate = median_metrics(samples)

        self.assertEqual(aggregate, LighthouseMetrics(0.83, 3920.0, 0.02, 55.0))
        self.assertEqual(guardrail_failures(aggregate), [])
        self.assertEqual(representative_index(samples, aggregate), 2)

    def test_rejects_persistent_lcp_regression(self):
        samples = [
            LighthouseMetrics(0.80, 4300, 0.02, 60),
            LighthouseMetrics(0.79, 4500, 0.03, 80),
            LighthouseMetrics(0.82, 4200, 0.01, 50),
        ]

        failures = guardrail_failures(median_metrics(samples))

        self.assertEqual(len(failures), 1)
        self.assertIn("LCP", failures[0])

    def test_requires_at_least_one_sample(self):
        with self.assertRaisesRegex(ValueError, "At least one Lighthouse sample"):
            median_metrics([])


if __name__ == "__main__":
    unittest.main()
