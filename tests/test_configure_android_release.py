from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.configure_android_release import configure

ROOT = Path(__file__).resolve().parents[1]


class ConfigureAndroidReleaseTests(unittest.TestCase):
    def test_release_metadata_contract(self) -> None:
        config = json.loads(
            (ROOT / "mobile" / "android_release.json").read_text(encoding="utf-8")
        )

        self.assertEqual(config["applicationId"], "com.teacherflavius.app")
        self.assertEqual(config["versionCode"], 1)
        self.assertEqual(config["versionName"], "1.0.0")
        self.assertEqual(config["brand"]["sourceSvg"], "assets/favicon.svg")

    def test_configures_version_and_vector_branding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            android_root = temp_root / "android"
            res_root = android_root / "app" / "src" / "main" / "res"
            res_root.mkdir(parents=True)
            (res_root / "drawable").mkdir()
            (res_root / "drawable" / "splash.png").write_bytes(b"template")
            (res_root / "values").mkdir()
            (res_root / "values" / "ic_launcher_background.xml").write_text(
                '<resources><color name="ic_launcher_background">#FFFFFF</color></resources>',
                encoding="utf-8",
            )

            build_gradle = android_root / "app" / "build.gradle"
            build_gradle.write_text(
                '''
android {
    defaultConfig {
        applicationId "com.teacherflavius.app"
        versionCode 1
        versionName "1.0"
    }
}
''',
                encoding="utf-8",
            )

            config = {
                "applicationId": "com.teacherflavius.app",
                "versionCode": 7,
                "versionName": "1.2.3",
                "brand": {
                    "sourceSvg": "assets/favicon.svg",
                    "backgroundColor": "#02102B",
                    "accentColor": "#2563EB",
                    "foregroundSecondary": "#DBEAFE",
                },
            }
            config_path = temp_root / "release.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")

            (temp_root / "assets").mkdir()
            (temp_root / "assets" / "favicon.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
                '<path d="M1 1h10v10z" fill="#fff"/>'
                '</svg>',
                encoding="utf-8",
            )

            configure(android_root, config_path, temp_root)

            updated = build_gradle.read_text(encoding="utf-8")
            self.assertIn("versionCode 7", updated)
            self.assertIn('versionName "1.2.3"', updated)
            self.assertTrue(
                (res_root / "drawable" / "ic_teacher_flavio_foreground.xml").is_file()
            )
            self.assertTrue((res_root / "drawable" / "splash.xml").is_file())
            self.assertFalse((res_root / "drawable" / "splash.png").exists())
            self.assertTrue(
                (res_root / "mipmap-anydpi-v26" / "ic_launcher.xml").is_file()
            )
            self.assertIn(
                "#02102B",
                (res_root / "values" / "teacher_flavio_colors.xml").read_text(
                    encoding="utf-8"
                ),
            )
            launcher_background = (
                res_root / "values" / "ic_launcher_background.xml"
            ).read_text(encoding="utf-8")
            self.assertIn("#02102B", launcher_background)
            self.assertEqual(launcher_background.count("ic_launcher_background"), 1)


if __name__ == "__main__":
    unittest.main()
