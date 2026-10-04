from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.prepare_android_web import prepare_android_web, rewrite_path


class PrepareAndroidWebTests(unittest.TestCase):
    def test_rewrites_clean_route_and_next_parameter(self) -> None:
        routes = {
            "/login/": "/login/index.html",
            "/area-do-estudante/": "/area-do-estudante/index.html",
        }

        value = "/login/?next=/area-do-estudante/"
        self.assertEqual(
            rewrite_path(value, routes),
            "/login/index.html?next=/area-do-estudante/index.html",
        )

    def test_preserves_asset_and_external_like_paths(self) -> None:
        routes = {"/login/": "/login/index.html"}

        self.assertEqual(rewrite_path("/assets/app.js", routes), "/assets/app.js")
        self.assertEqual(rewrite_path("//example.com/login/", routes), "//example.com/login/")

    def test_prepares_android_copy_without_mutating_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "_site"
            destination = root / "_android_site"
            (source / "login").mkdir(parents=True)
            (source / "area-do-estudante").mkdir(parents=True)
            (source / "login" / "index.html").write_text("<h1>Login</h1>", encoding="utf-8")
            (source / "area-do-estudante" / "index.html").write_text("<h1>Aluno</h1>", encoding="utf-8")
            home = (
                '<!doctype html><html><head><title>Home</title></head>'
                '<body><a href="/login/?next=/area-do-estudante/">Entrar</a></body></html>'
            )
            (source / "index.html").write_text(home, encoding="utf-8")
            script = 'window.location.replace("/area-do-estudante/");'
            (source / "app.js").write_text(script, encoding="utf-8")

            prepare_android_web(source, destination)

            self.assertEqual((source / "index.html").read_text(encoding="utf-8"), home)
            self.assertIn(
                'href="/login/index.html?next=/area-do-estudante/index.html"',
                (destination / "index.html").read_text(encoding="utf-8"),
            )
            self.assertIn(
                'window.location.replace("/area-do-estudante/index.html")',
                (destination / "app.js").read_text(encoding="utf-8"),
            )
            self.assertIn(
                '/native_auth_bridge.js?v=20261004-1',
                (destination / "index.html").read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
