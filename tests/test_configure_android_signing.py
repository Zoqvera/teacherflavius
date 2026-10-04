from __future__ import annotations

import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.configure_android_signing import configure


class ConfigureAndroidSigningTests(unittest.TestCase):
    def test_leaves_release_unsigned_when_secrets_are_absent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            android_root = Path(directory) / "android"
            app_root = android_root / "app"
            app_root.mkdir(parents=True)
            build_gradle = app_root / "build.gradle"
            original = """android {
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
"""
            build_gradle.write_text(original, encoding="utf-8")

            with mock.patch.dict(os.environ, {}, clear=True):
                self.assertFalse(configure(android_root))

            self.assertEqual(build_gradle.read_text(encoding="utf-8"), original)
            self.assertFalse(
                (android_root / "keystore" / "teacher-flavio-upload.jks").exists()
            )

    def test_configures_release_signing_from_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            android_root = Path(directory) / "android"
            app_root = android_root / "app"
            app_root.mkdir(parents=True)
            build_gradle = app_root / "build.gradle"
            build_gradle.write_text(
                """android {
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
""",
                encoding="utf-8",
            )

            payload = b"keystore-placeholder-" + (b"x" * 300)
            environment = {
                "ANDROID_KEYSTORE_BASE64": base64.b64encode(payload).decode("ascii"),
                "ANDROID_KEYSTORE_PASSWORD": "store-secret",
                "ANDROID_KEY_ALIAS": "teacherflavius-upload",
                "ANDROID_KEY_PASSWORD": "key-secret",
            }

            with mock.patch.dict(os.environ, environment, clear=True):
                self.assertTrue(configure(android_root))

            updated = build_gradle.read_text(encoding="utf-8")
            self.assertIn("signingConfigs", updated)
            self.assertIn("teacher-flavio-upload.jks", updated)
            self.assertIn("signingConfig signingConfigs.release", updated)
            self.assertIn('System.getenv("ANDROID_KEYSTORE_PASSWORD")', updated)
            self.assertNotIn("store-secret", updated)
            self.assertNotIn("key-secret", updated)

            keystore = android_root / "keystore" / "teacher-flavio-upload.jks"
            self.assertEqual(keystore.read_bytes(), payload)
            self.assertEqual(keystore.stat().st_mode & 0o777, 0o600)

    def test_rejects_partial_signing_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            android_root = Path(directory) / "android"
            (android_root / "app").mkdir(parents=True)
            (android_root / "app" / "build.gradle").write_text(
                "android {\n    buildTypes { release { } }\n}\n",
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"ANDROID_KEYSTORE_BASE64": "Zm9v"},
                clear=True,
            ):
                with self.assertRaises(SystemExit):
                    configure(android_root)


if __name__ == "__main__":
    unittest.main()
