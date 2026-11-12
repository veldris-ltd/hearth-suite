"""Tests for ci/jobs/dco.sh, the Developer Certificate of Origin check (L-10)."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DCO = REPO_ROOT / "ci" / "jobs" / "dco.sh"
BASH = shutil.which("bash")


@unittest.skipIf(BASH is None, "bash is not available")
class DcoCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.commit("base", name="Maintainer", email="maint@example.org")
        self.base = self.rev("HEAD")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def git(self, *args: str, env: dict[str, str] | None = None) -> str:
        full_env = {**os.environ, **(env or {})}
        for key in ("GITHUB_ACTIONS", "GITLAB_CI"):
            full_env.pop(key, None)
        return subprocess.run(
            ["git", "-c", "commit.gpgsign=false", *args],
            cwd=self.repo,
            env=full_env,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def rev(self, ref: str) -> str:
        return self.git("rev-parse", ref)

    def commit(self, message: str, *, name: str, email: str, signoff: str | None = None) -> None:
        (self.repo / f"{message}.txt").write_text(message, encoding="utf-8")
        self.git("add", "-A")
        body = message if signoff is None else f"{message}\n\nSigned-off-by: {signoff}"
        ident = {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
        }
        self.git("commit", "-q", "-m", body, env=ident)

    def run_dco(self) -> subprocess.CompletedProcess[str]:
        env = {k: v for k, v in os.environ.items() if k not in ("GITHUB_ACTIONS", "GITLAB_CI")}
        env.update(DCO_BASE=self.base, DCO_HEAD="HEAD", DCO_REPO=str(self.repo))
        return subprocess.run([BASH, str(DCO)], env=env, capture_output=True, text=True)

    def test_signed_off_commits_pass(self) -> None:
        self.commit("one", name="Ada", email="ada@example.org", signoff="Ada <ada@example.org>")
        self.commit("two", name="Ada", email="Ada@Example.org", signoff="Ada <ada@example.org>")
        result = self.run_dco()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 commit(s) signed off", result.stdout)

    def test_missing_signoff_fails(self) -> None:
        self.commit("one", name="Ada", email="ada@example.org", signoff="Ada <ada@example.org>")
        self.commit("two", name="Ada", email="ada@example.org")
        result = self.run_dco()
        self.assertEqual(result.returncode, 1)
        self.assertIn("1 of 2 commit(s) are not signed off", result.stderr)

    def test_signoff_by_someone_else_fails(self) -> None:
        self.commit("one", name="Ada", email="ada@example.org", signoff="Bob <bob@example.org>")
        result = self.run_dco()
        self.assertEqual(result.returncode, 1)
        self.assertIn("<ada@example.org>", result.stderr)

    def test_merge_commits_are_skipped(self) -> None:
        self.git("checkout", "-q", "-b", "topic")
        self.commit("topic", name="Ada", email="ada@example.org", signoff="Ada <ada@example.org>")
        self.git("checkout", "-q", "main")
        self.commit("side", name="Ada", email="ada@example.org", signoff="Ada <ada@example.org>")
        ident = {"GIT_AUTHOR_NAME": "Ada", "GIT_AUTHOR_EMAIL": "ada@example.org",
                 "GIT_COMMITTER_NAME": "Ada", "GIT_COMMITTER_EMAIL": "ada@example.org"}
        self.git("merge", "-q", "--no-ff", "-m", "merge topic", "topic", env=ident)
        result = self.run_dco()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 commit(s) signed off", result.stdout)

    def test_missing_base_fails(self) -> None:
        env = {k: v for k, v in os.environ.items() if k not in ("GITHUB_ACTIONS", "GITLAB_CI", "DCO_BASE")}
        env["DCO_REPO"] = str(self.repo)
        result = subprocess.run([BASH, str(DCO)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("DCO_BASE is not set", result.stderr)


if __name__ == "__main__":
    unittest.main()
