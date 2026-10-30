"""Release exception boundaries; no real-device E2E claims."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import waiver_042

PRODUCTION_WAIVER_SHA256 = waiver_042.WAIVER_SHA256


class Waiver042Tests(unittest.TestCase):
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
        self.waiver = self.evidence / "release-waiver-0.4.2.json"
        self.waiver.write_bytes(b"unit-test pinned authorization")
        for field, path in (("MANIFEST_SHA256", self.manifest), ("GATE_SHA256", self.gate),
                            ("WAIVER_SHA256", self.waiver)):
            patcher = mock.patch.object(waiver_042, field, hashlib.sha256(path.read_bytes()).hexdigest())
            patcher.start()
            self.addCleanup(patcher.stop)
        self.baseline = {"validate_candidate": mock.Mock(return_value={
            "version": waiver_042.VERSION, "commit": waiver_042.COMMIT}),
            "check_promotion": mock.Mock()}
        patcher = mock.patch.object(waiver_042.runpy, "run_path", return_value=self.baseline)
        self.run_gate = patcher.start()
        self.addCleanup(patcher.stop)

    def verify(self):
        return waiver_042.verify(self.root, self.evidence, self.root / "stable.txt")

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
        self.baseline["check_promotion"].assert_called_once_with("0.4.2", self.root / "stable.txt")
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
        record = Path(__file__).parent / "waivers/0.4.2.json"
        waiver_042.require_hash(record, PRODUCTION_WAIVER_SHA256)
        data = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], waiver_042.VERSION)
        self.assertEqual(data["commit"], waiver_042.COMMIT)
        self.assertEqual(data["archiveSha256"], waiver_042.ARCHIVE_SHA256)
        self.assertNotIn("passed", data)


if __name__ == "__main__":
    unittest.main()
