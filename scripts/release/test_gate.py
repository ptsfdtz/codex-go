"""Negative tests for release admission; these do not constitute real E2E evidence."""
import io
import json
import tarfile
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import gate
from extract import extract


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.candidate = self.root / "candidate"
        self.evidence = self.root / "evidence"
        self.candidate.mkdir()
        self.evidence.mkdir()
        self.manifest = {"schemaVersion": 1, "version": "1.2.3", "commit": "a" * 40, "artifacts": {}}
        for name in ("web.tar.gz", "pages.tar.gz", "agentdeck-cloud", "install.ps1", "install.sh", "install-codex.ps1", "release-gate.py"):
            self.artifact(name, b"unit-test artifact")
        self.artifact("releases/stable.txt", b"1.2.3\n")
        self.artifact("releases/1.2.3/notes.txt", b"unit-test release notes")
        for target in gate.PLATFORMS:
            archive = f"releases/1.2.3/agentdeck-{target}." + ("zip" if target.startswith("windows") else "tar.gz")
            self.artifact(archive, b"unit-test package")
            self.artifact(archive + ".sha256", self.manifest["artifacts"][archive].encode())
            os_name, arch = target.split("-")
            self.artifact(f"releases/1.2.3/{target}.json", json.dumps({"version": "1.2.3", "platform": os_name,
                "arch": arch, "file": Path(archive).name, "sha256": self.manifest["artifacts"][archive]}).encode())
        self.write(self.candidate / "candidate.json", self.manifest)
        for target in gate.PLATFORMS:
            log = f"{target}.txt"
            (self.evidence / log).write_text("unit-test evidence, not a real E2E run", encoding="utf-8")
            report = {"schemaVersion": 1, "version": "1.2.3", "commit": "a" * 40,
                      "candidateSha256": gate.digest(self.candidate / "candidate.json"), "platform": target,
                      "tester": "unit-test", "testedAt": "2026-01-01T00:00:00Z", "runningVersion": "1.2.3",
                      "osVersion": "unit-test", "codexVersion": "unit-test", "hostId": "unit-test", "sessionId": "unit-test",
                      "checks": {c: {"passed": True, "observed": "unit-test"} for c in gate.CHECKS},
                      "logs": {log: gate.digest(self.evidence / log)}}
            self.write(self.evidence / f"{target}.json", report)

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def artifact(self, name, content):
        path = self.candidate / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        self.manifest["artifacts"][name] = gate.digest(path)

    def verify(self):
        return gate.verify(self.candidate, self.evidence)

    def test_complete_matching_matrix_is_admitted(self):
        self.assertEqual(self.verify()["version"], "1.2.3")

    def test_each_platform_is_required(self):
        for target in gate.PLATFORMS:
            path = self.evidence / f"{target}.json"
            data = path.read_bytes()
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                self.verify()
            path.write_bytes(data)

    def test_changed_candidate_bytes_rejected(self):
        (self.candidate / "web.tar.gz").write_bytes(b"replaced after test")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.verify()

    def test_resealed_candidate_invalidates_previous_tests(self):
        self.manifest["commit"] = "b" * 40
        self.write(self.candidate / "candidate.json", self.manifest)
        with self.assertRaisesRegex(ValueError, "another candidate"):
            self.verify()

    def test_failed_or_unobserved_real_check_rejected(self):
        path = self.evidence / "windows-x64.json"
        report = gate.load(path)
        report["checks"]["realModelHistory"]["passed"] = False
        self.write(path, report)
        with self.assertRaisesRegex(ValueError, "realModelHistory"):
            self.verify()
        report["checks"]["realModelHistory"] = {"passed": True, "observed": ""}
        self.write(path, report)
        with self.assertRaisesRegex(ValueError, "realModelHistory"):
            self.verify()

    def test_log_tampering_rejected(self):
        (self.evidence / "linux-x64.txt").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "evidence changed"):
            self.verify()

    def test_wrong_running_version_rejected(self):
        path = self.evidence / "linux-arm64.json"
        report = gate.load(path)
        report["runningVersion"] = "1.2.2"
        self.write(path, report)
        with self.assertRaisesRegex(ValueError, "not running"):
            self.verify()

    def test_old_candidate_cannot_replace_new_stable(self):
        path = self.root / "stable.txt"
        path.write_text("1.3.0", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "older candidate"):
            gate.check_promotion("1.2.3", path)
        gate.check_promotion("1.3.0", path)
        gate.check_promotion("1.4.0", path)

    def test_macos_evidence_uses_package_platform_name(self):
        with mock.patch.object(gate.sys, "platform", "darwin"), mock.patch.object(
            gate.system_platform, "machine", return_value="arm64"
        ):
            self.assertEqual(gate.recorded_platform(), "macos-arm64")
        self.assertIn("macos-arm64", gate.PLATFORMS)

    def test_artifact_traversal_rejected(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            gate.safe_file(self.candidate, "../outside")

    def test_unsafe_archive_members_rejected(self):
        for name, kind in (("../escaped", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)):
            archive = self.root / "unsafe.tar.gz"
            with tarfile.open(archive, "w:gz") as stream:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "../escaped"
                member.size = 1 if kind == tarfile.REGTYPE else 0
                stream.addfile(member, io.BytesIO(b"x") if member.size else None)
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                extract(archive, self.root / "output")


if __name__ == "__main__":
    unittest.main()
