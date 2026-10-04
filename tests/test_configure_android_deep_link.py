from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.configure_android_deep_link import (
    APP_SCHEME,
    CALLBACK_HOST,
    configure_manifest,
)


class ConfigureAndroidDeepLinkTests(unittest.TestCase):
    def test_adds_oauth_callback_filter_once(self) -> None:
        manifest = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "AndroidManifest.xml"
            path.write_text(manifest, encoding="utf-8")

            self.assertTrue(configure_manifest(path))
            self.assertFalse(configure_manifest(path))

            updated = path.read_text(encoding="utf-8")
            self.assertIn(f'android:scheme="{APP_SCHEME}"', updated)
            self.assertIn(f'android:host="{CALLBACK_HOST}"', updated)
            self.assertEqual(updated.count("android.intent.action.VIEW"), 1)


if __name__ == "__main__":
    unittest.main()
