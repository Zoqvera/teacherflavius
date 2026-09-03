from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_site_dependencies import (  # noqa: E402
    ANALYTICS_DEPENDENCIES,
    AUTH_DEPENDENCIES,
    DEPENDENCY_GROUPS,
    PORTAL_HELPER_DEPENDENCIES,
)


class StaticSiteDependenciesTests(unittest.TestCase):
    def test_groups_preserve_expected_cardinality(self) -> None:
        self.assertEqual(len(AUTH_DEPENDENCIES), 4)
        self.assertEqual(len(ANALYTICS_DEPENDENCIES), 4)
        self.assertEqual(len(PORTAL_HELPER_DEPENDENCIES), 1)
        self.assertEqual(DEPENDENCY_GROUPS, (AUTH_DEPENDENCIES, ANALYTICS_DEPENDENCIES, PORTAL_HELPER_DEPENDENCIES))

    def test_groups_target_expected_entrypoints(self) -> None:
        self.assertEqual({item.target_filename for item in AUTH_DEPENDENCIES}, {"auth.js"})
        self.assertEqual({item.target_filename for item in ANALYTICS_DEPENDENCIES}, {"analytics.js"})
        self.assertEqual({item.target_filename for item in PORTAL_HELPER_DEPENDENCIES}, {"site_footer.js"})

    def test_dependency_sources_preserve_versioned_contracts(self) -> None:
        sources = [item.dependency_src for group in DEPENDENCY_GROUPS for item in group]
        self.assertIn("/supabase_client_service.js?v=20260902-1", sources)
        self.assertIn("/analytics_payments.js?v=20260902-1", sources)
        self.assertIn("/resource_waiter.js?v=20260902-2", sources)
        self.assertEqual(len(sources), len(set(sources)))


if __name__ == "__main__":
    unittest.main()
