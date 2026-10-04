from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CapacitorAndroidContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = json.loads(
            (ROOT / "capacitor.config.json").read_text(encoding="utf-8")
        )
        self.package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    def test_capacitor_uses_bundled_static_site(self) -> None:
        self.assertEqual(self.config["appId"], "com.teacherflavius.app")
        self.assertEqual(self.config["appName"], "Teacher Flávio")
        self.assertEqual(self.config["webDir"], "_android_site")
        self.assertNotIn("url", self.config.get("server", {}))

    def test_capacitor_8_packages_are_pinned_together(self) -> None:
        dependencies = self.package["dependencies"]
        dev_dependencies = self.package["devDependencies"]

        self.assertEqual(dependencies["@capacitor/core"], "8.5.2")
        self.assertEqual(dependencies["@capacitor/android"], "8.5.2")
        self.assertEqual(dependencies["@capacitor/app"], "8.1.2")
        self.assertEqual(dependencies["@capacitor/browser"], "8.0.5")
        self.assertEqual(dev_dependencies["@capacitor/cli"], "8.5.2")

    def test_mobile_scripts_build_before_sync(self) -> None:
        scripts = self.package["scripts"]

        self.assertIn("scripts/build_static_site.py", scripts["mobile:web"])
        self.assertIn("scripts/materialize_site.py", scripts["mobile:web"])
        self.assertIn("scripts/postprocess_production.py", scripts["mobile:web"])
        self.assertIn("scripts/prepare_android_web.py", scripts["mobile:web"])
        self.assertIn("npm run mobile:web", scripts["mobile:android:sync"])
        self.assertIn("configure_android_deep_link.py", scripts["mobile:android:add"])
        self.assertIn("configure_android_deep_link.py", scripts["mobile:android:sync"])
        self.assertIn("configure_android_release.py", scripts["mobile:android:sync"])
        self.assertIn("cap sync android", scripts["mobile:android:sync"])
        self.assertIn("configure_android_signing.py", scripts["mobile:android:bundle"])
        self.assertIn("bundleRelease", scripts["mobile:android:bundle"])

    def test_android_workflow_builds_and_uploads_debug_apk(self) -> None:
        workflow = (
            ROOT / ".github" / "workflows" / "android-capacitor-build.yml"
        ).read_text(encoding="utf-8")

        self.assertIn('node-version: "22"', workflow)
        self.assertIn('java-version: "21"', workflow)
        self.assertIn("platforms;android-36", workflow)
        self.assertIn("npx cap add android", workflow)
        self.assertIn("Configure OAuth deep link", workflow)
        self.assertIn("Configure Android release", workflow)
        self.assertIn("Validate native route preparation", workflow)
        self.assertIn("bundleRelease", workflow)
        self.assertIn("teacher-flavio-android-release-signed", workflow)
        self.assertIn("teacher-flavio-android-release-unsigned", workflow)
        self.assertIn("ANDROID_KEYSTORE_BASE64", workflow)
        self.assertIn("jarsigner -verify -strict", workflow)
        self.assertIn('android:host="login-callback"', workflow)
        self.assertIn("@capacitor/browser", workflow)
        self.assertIn("./gradlew assembleDebug", workflow)
        self.assertIn("actions/upload-artifact@v7", workflow)

    def test_login_contains_native_pkce_callback_flow(self) -> None:
        login = (ROOT / "login.html").read_text(encoding="utf-8")

        self.assertIn("native_callback", login)
        self.assertIn("native_code", login)
        self.assertIn("skipBrowserRedirect: isNative", login)
        self.assertIn("exchangeCodeForSession", login)
        self.assertIn("com.teacherflavius.app://login-callback", login)


if __name__ == "__main__":
    unittest.main()
