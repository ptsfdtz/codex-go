"""Release exception boundaries; no real-device E2E claims."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import waiver_043

PRODUCTION_WAIVER_SHA256 = waiver_043.WAIVER_SHA256


class Waiver043Tests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        self.manifest = self.root / "candidate.json"
        self.manifest.write_bytes(b"unit-test pinned manifest")
        self.gate = self.root / "release-gate.py"
        self.gate.write_bytes(b"raise AssertionError('unverified code executed')")
        self.waiver = self.evidence / "release-waiver-0.4.3.json"
        self.waiver.write_bytes(b"unit-test pinned authorization")
        for field, path in (("MANIFEST_SHA256", self.manifest), ("GATE_SHA256", self.gate),
                            ("WAIVER_SHA256", self.waiver)):
            patcher = mock.patch.object(waiver_043, field, hashlib.sha256(path.read_bytes()).hexdigest())
            patcher.start()
            self.addCleanup(patcher.stop)
        self.linux = mock.patch.object(waiver_043, "verify_linux")
        self.verify_linux = self.linux.start()
        self.addCleanup(self.linux.stop)
        self.baseline = {"validate_candidate": mock.Mock(return_value={
            "version": waiver_043.VERSION, "commit": waiver_043.COMMIT}),
            "check_promotion": mock.Mock()}
        patcher = mock.patch.object(waiver_043.runpy, "run_path", return_value=self.baseline)
        self.run_gate = patcher.start()
        self.addCleanup(patcher.stop)

    def verify(self):
        return waiver_043.verify(self.root, self.evidence, self.root / "stable.txt")

    def test_other_candidate_gate_or_waiver_rejected_before_execution(self):
        for path in (self.manifest, self.gate, self.waiver):
            original = path.read_bytes()
            path.write_bytes(original + b" changed")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                self.verify()
            self.run_gate.assert_not_called()
            path.write_bytes(original)

    def test_missing_authorization_rejected(self):
        self.waiver.unlink()
        with self.assertRaisesRegex(ValueError, "Missing regular pinned file"):
            self.verify()
        self.run_gate.assert_not_called()

    def test_integrity_and_downgrade_checks_are_retained(self):
        self.verify()
        self.baseline["validate_candidate"].assert_called_once_with(self.root)
        self.baseline["check_promotion"].assert_called_once_with("0.4.3", self.root / "stable.txt")
        self.baseline["check_promotion"].side_effect = ValueError("older candidate")
        with self.assertRaisesRegex(ValueError, "older candidate"):
            self.verify()
        self.baseline["check_promotion"].side_effect = None
        self.baseline["validate_candidate"].side_effect = ValueError("artifact integrity failure")
        with self.assertRaisesRegex(ValueError, "integrity failure"):
            self.verify()

    def test_version_and_source_cannot_change(self):
        for field in ("version", "commit"):
            original = self.baseline["validate_candidate"].return_value[field]
            self.baseline["validate_candidate"].return_value[field] = "different"
            with self.assertRaisesRegex(ValueError, "source identity"):
                self.verify()
            self.baseline["validate_candidate"].return_value[field] = original

    def test_record_matches_production_constants(self):
        record = Path(__file__).parent / "waivers/0.4.3.json"
        waiver_043.require_hash(record, PRODUCTION_WAIVER_SHA256)
        data = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], waiver_043.VERSION)
        self.assertEqual(data["commit"], waiver_043.COMMIT)
        self.assertEqual(data["archiveSha256"], waiver_043.ARCHIVE_SHA256)
        self.assertNotIn("passed", data)


class LinuxEvidenceTests(unittest.TestCase):
    def setUp(self):
        import gate
        from test_gate import ReleaseGateTests
        self.fixture = ReleaseGateTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.temporary.cleanup)
        self.root = self.fixture.candidate
        self.evidence = self.fixture.evidence
        for name in ("VERSION", "COMMIT", "MANIFEST_SHA256"):
            value = {"VERSION": "1.2.3", "COMMIT": "a" * 40,
                     "MANIFEST_SHA256": gate.digest(self.root / "candidate.json")}[name]
            patcher = mock.patch.object(waiver_043, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.baseline = vars(gate)
        self.gate = gate
        for target in ("windows-x64", "macos-arm64"):
            (self.evidence / (target + ".json")).unlink()

    def verify(self):
        for target in waiver_043.REQUIRED_PLATFORMS:
            waiver_043.verify_linux(self.baseline, self.root, self.evidence, {}, target)

    def test_windows_and_macos_are_not_required(self):
        self.verify()

    def test_each_linux_is_required(self):
        for target in waiver_043.REQUIRED_PLATFORMS:
            path = self.evidence / (target + ".json")
            data = path.read_bytes()
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                self.verify()
            path.write_bytes(data)

    def test_each_linux_check_and_observation_is_required(self):
        for target in waiver_043.REQUIRED_PLATFORMS:
            path = self.evidence / (target + ".json")
            report = self.gate.load(path)
            for check in self.gate.CHECKS:
                for invalid in ({"passed": False, "observed": "failed"}, {"passed": True, "observed": ""}):
                    changed = json.loads(json.dumps(report))
                    changed["checks"][check] = invalid
                    self.fixture.write(path, changed)
                    with self.assertRaisesRegex(ValueError, check):
                        self.verify()
            self.fixture.write(path, report)

    def test_linux_runtime_and_logs_are_verified(self):
        path = self.evidence / "linux-arm64.json"
        report = self.gate.load(path)
        report["officialRuntime"]["executableSha256"] = "0" * 64
        self.fixture.write(path, report)
        with self.assertRaisesRegex(ValueError, "official precompiled"):
            self.verify()
        (self.evidence / "linux-x64.txt").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "evidence changed"):
            waiver_043.verify_linux(self.baseline, self.root, self.evidence, {}, "linux-x64")


if __name__ == "__main__":
    unittest.main()
