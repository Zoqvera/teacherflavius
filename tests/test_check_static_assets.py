"""Contract tests for static asset availability checks."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError

from sys import path as import_path

import_path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_static_assets import (  # noqa: E402
    ASSETS,
    AssetCheckError,
    StaticAsset,
    check_local_build,
    check_remote_assets,
    probe_asset,
    validate_delivery,
)


class FakeResponse:
    def __init__(self, status: int, content_type: str, content: bytes) -> None:
        self.status = status
        self.headers = {"Content-Type": content_type, "CF-Cache-Status": "HIT"}
        self.content = content

    def read(self, size: int) -> bytes:
        return self.content[:size]

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        pass


class StaticAssetsTests(unittest.TestCase):
    def test_known_assets_have_unique_paths_and_correct_kinds(self) -> None:
        self.assertEqual(len(ASSETS), len({asset.path for asset in ASSETS}))
        for asset in ASSETS:
            self.assertTrue(asset.path.startswith("/"))
            self.assertIn(Path(asset.path).suffix, {".js", ".css"})

    def test_javascript_200_with_expected_mime_is_valid(self) -> None:
        urls = []

        def open_fake(request: object, timeout: int) -> FakeResponse:
            urls.append((request.full_url, request.get_method(), timeout))
            return FakeResponse(200, "application/javascript; charset=utf-8", b"(() => {})();")

        result = probe_asset(ASSETS[0], opener=open_fake)
        self.assertIn("HTTP 200", result)
        self.assertEqual(urls, [("https://teacherflavius.com/error_monitor.js", "GET", 8)])

    def test_css_200_is_valid(self) -> None:
        asset = StaticAsset("/animated_cards.css", frozenset({"text/css"}))
        validate_delivery(asset, 200, "text/css; charset=utf-8", b".card{display:block}")

    def test_html_fallback_and_wrong_mime_are_invalid(self) -> None:
        for mime, body in (
            ("text/html", b"<!doctype html><html></html>"),
            ("text/javascript", b"<html><body>not an asset</body></html>"),
            ("application/json", b'{"error":"missing"}'),
        ):
            with self.subTest(mime=mime, body=body):
                with self.assertRaises(AssetCheckError):
                    validate_delivery(ASSETS[0], 200, mime, body)

    def test_http_failure_empty_body_and_missing_type_are_invalid(self) -> None:
        for status, mime, body in (
            (404, "text/javascript", b"not found"),
            (500, "text/javascript", b"error"),
            (200, "text/javascript", b""),
            (200, "", b"body"),
        ):
            with self.subTest(status=status, mime=mime, body=body):
                with self.assertRaises(AssetCheckError):
                    validate_delivery(ASSETS[0], status, mime, body)

    def test_real_http_exception_becomes_sanitized_failure(self) -> None:
        def open_fail(_request: object, timeout: int) -> FakeResponse:
            raise HTTPError("https://teacherflavius.com/error_monitor.js", 404, "Not Found", {}, None)

        with self.assertRaisesRegex(AssetCheckError, "HTTP 404"):
            probe_asset(ASSETS[0], opener=open_fail)

    def test_retries_only_failed_assets_and_fails_after_exhaustion(self) -> None:
        counts = {}
        slept = []

        def flaky(asset: StaticAsset) -> str:
            counts[asset.path] = counts.get(asset.path, 0) + 1
            if counts[asset.path] == 1:
                raise AssetCheckError("transient")
            return "HTTP 200"

        check_remote_assets(assets=ASSETS[:2], attempts=2, delay_seconds=1, probe=flaky, sleeper=slept.append)
        self.assertEqual(slept, [1, 1])
        self.assertEqual(list(counts.values()), [2, 2])

        def always_fail(_asset: StaticAsset) -> str:
            raise AssetCheckError("HTTP 503")

        with self.assertRaisesRegex(AssetCheckError, "Unavailable or invalid assets"):
            check_remote_assets(assets=ASSETS[:1], attempts=2, delay_seconds=0, probe=always_fail, sleeper=lambda _: None)

    def test_local_build_requires_nonempty_files(self) -> None:
        asset = ASSETS[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(AssetCheckError):
                check_local_build(root, (asset,))
            target = root / asset.path.lstrip("/")
            target.write_bytes(b"script")
            check_local_build(root, (asset,))
            target.write_bytes(b"")
            with self.assertRaises(AssetCheckError):
                check_local_build(root, (asset,))

    def test_rejects_invalid_retry_settings(self) -> None:
        with self.assertRaises(ValueError):
            check_remote_assets(attempts=0)
        with self.assertRaises(ValueError):
            check_remote_assets(attempts=1, delay_seconds=-1)


if __name__ == "__main__":
    unittest.main()
