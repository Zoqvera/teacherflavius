from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from git_revision import current_commit_sha  # noqa: E402


class GitRevisionTests(unittest.TestCase):
    def test_reads_current_commit_sha_from_repository_root(self) -> None:
        root = Path("/tmp/project")
        completed = Mock(stdout="abc123\n")
        with patch("git_revision.subprocess.run", return_value=completed) as run:
            sha = current_commit_sha(root)

        self.assertEqual(sha, "abc123")
        run.assert_called_once_with(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
