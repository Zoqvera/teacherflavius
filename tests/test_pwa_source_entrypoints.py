from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PwaSourceEntrypointTests(unittest.TestCase):
    def test_published_entrypoints_load_manifest_and_registration(self) -> None:
        entrypoints = (
            ROOT / "index.html",
            ROOT / "area-do-estudante" / "index.html",
            ROOT / "area_do_estudante.html",
        )

        for path in entrypoints:
            html = path.read_text(encoding="utf-8")
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertIn('/site.webmanifest', html)
                self.assertIn('/pwa_registration.js', html)

    def test_student_source_contains_install_controller(self) -> None:
        html = (ROOT / "area_do_estudante.html").read_text(encoding="utf-8")
        self.assertIn('id="pwaInstallCard"', html)
        self.assertIn('id="pwaInstallButton"', html)
        self.assertIn('/pwa_install_prompt.js', html)

    def test_installed_app_starts_in_student_area(self) -> None:
        manifest = json.loads((ROOT / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["start_url"], "/area-do-estudante/")
        self.assertEqual(manifest["scope"], "/")

    def test_materialization_workflow_does_not_push_to_protected_main(self) -> None:
        workflow = (
            ROOT / ".github" / "workflows" / "materialize-gtm-github-pages.yml"
        ).read_text(encoding="utf-8")

        self.assertNotIn("git push origin HEAD:main", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)


if __name__ == "__main__":
    unittest.main()
