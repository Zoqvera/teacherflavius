#!/usr/bin/env python3
"""Validate Lighthouse performance guardrails using the median of repeated samples."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any

MIN_PERFORMANCE_SCORE = 0.65
MAX_LCP_MS = 4_000
MAX_CLS = 0.15
MAX_TBT_MS = 800


@dataclass(frozen=True)
class LighthouseMetrics:
    score: float
    lcp_ms: float
    cls: float
    tbt_ms: float


def load_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_metrics(report: dict[str, Any]) -> LighthouseMetrics:
    audits = report["audits"]
    return LighthouseMetrics(
        score=float(report["categories"]["performance"]["score"] or 0),
        lcp_ms=float(audits["largest-contentful-paint"]["numericValue"]),
        cls=float(audits["cumulative-layout-shift"]["numericValue"]),
        tbt_ms=float(audits["total-blocking-time"]["numericValue"]),
    )


def median_metrics(samples: list[LighthouseMetrics]) -> LighthouseMetrics:
    if not samples:
        raise ValueError("At least one Lighthouse sample is required")
    return LighthouseMetrics(
        score=float(median(sample.score for sample in samples)),
        lcp_ms=float(median(sample.lcp_ms for sample in samples)),
        cls=float(median(sample.cls for sample in samples)),
        tbt_ms=float(median(sample.tbt_ms for sample in samples)),
    )


def guardrail_failures(metrics: LighthouseMetrics) -> list[str]:
    failures: list[str] = []
    if metrics.score < MIN_PERFORMANCE_SCORE:
        failures.append(f"performance score {metrics.score:.2f} < {MIN_PERFORMANCE_SCORE:.2f}")
    if metrics.lcp_ms > MAX_LCP_MS:
        failures.append(f"LCP {metrics.lcp_ms:.0f}ms > {MAX_LCP_MS}ms")
    if metrics.cls > MAX_CLS:
        failures.append(f"CLS {metrics.cls:.3f} > {MAX_CLS:.2f}")
    if metrics.tbt_ms > MAX_TBT_MS:
        failures.append(f"TBT {metrics.tbt_ms:.0f}ms > {MAX_TBT_MS}ms")
    return failures


def print_diagnostics(report: dict[str, Any]) -> None:
    audits = report["audits"]
    print("Top JavaScript CPU consumers:")
    bootup = audits.get("bootup-time", {}).get("details", {}).get("items", [])
    for item in sorted(bootup, key=lambda value: float(value.get("total", 0)), reverse=True)[:10]:
        print(
            f"- total={float(item.get('total', 0)):.0f}ms "
            f"scripting={float(item.get('scripting', 0)):.0f}ms "
            f"url={item.get('url', 'unknown')}"
        )

    print("Top transfer consumers:")
    requests = audits.get("network-requests", {}).get("details", {}).get("items", [])
    for item in sorted(requests, key=lambda value: int(value.get("transferSize", 0)), reverse=True)[:10]:
        print(f"- bytes={int(item.get('transferSize', 0))} url={item.get('url', 'unknown')}")


def representative_index(samples: list[LighthouseMetrics], aggregate: LighthouseMetrics) -> int:
    return min(
        range(len(samples)),
        key=lambda index: (
            abs(samples[index].lcp_ms - aggregate.lcp_ms),
            abs(samples[index].score - aggregate.score),
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reports", nargs="+", type=Path)
    args = parser.parse_args()

    reports = [load_report(path) for path in args.reports]
    samples = [extract_metrics(report) for report in reports]
    aggregate = median_metrics(samples)

    for index, metrics in enumerate(samples, start=1):
        print(
            f"sample={index} performance={metrics.score:.2f} "
            f"lcp_ms={metrics.lcp_ms:.0f} cls={metrics.cls:.3f} tbt_ms={metrics.tbt_ms:.0f}"
        )

    print(
        f"median performance={aggregate.score:.2f} lcp_ms={aggregate.lcp_ms:.0f} "
        f"cls={aggregate.cls:.3f} tbt_ms={aggregate.tbt_ms:.0f}"
    )

    print_diagnostics(reports[representative_index(samples, aggregate)])

    failures = guardrail_failures(aggregate)
    if failures:
        print("Lighthouse median guardrails: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Lighthouse median guardrails: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
