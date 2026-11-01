"""Admit only the pinned 0.4.3 candidate with Windows/macOS E2E waived.

Linux x64/ARM64 still require real candidate-bound E2E reports. The default
four-platform gate and future releases do not accept this exception.
"""
import argparse
import datetime
import hashlib
import re
import runpy
from pathlib import Path

VERSION = "0.4.3"
COMMIT = "b7ebd99445a3450f096247388420d041fb2dbbda"
MANIFEST_SHA256 = "0400e29fe7a6b70d47c1470793020e47304bceeb6725b7e6dc02ffc41e669c6f"
ARCHIVE_SHA256 = "3c385a474f168ada9ece4eb960188d6c75fb1424d9fae9836bdc8529737f89c4"
GATE_SHA256 = "0884055b5afafe6b754fd0564a3a20106b6e4e509e8c9d7ef67b37e4b43621eb"
WAIVER_SHA256 = "e4b636b66dc244dbd34c2275e6c912a5265330bdee80ac271e3e931acf081fd0"
REQUIRED_PLATFORMS = ("linux-x64", "linux-arm64")


def require_hash(path, expected):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular pinned file: {path.name}")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"Outside the 0.4.3 waiver: {path.name} hash differs")


def verify_linux(baseline, root, evidence, manifest, platform):
    # Preserve every real-device check from the candidate's original gate for
    # the two platforms which the owner did not waive.
    report = baseline["load"](evidence / f"{platform}.json")
    if (report.get("schemaVersion") != 1 or report.get("platform") != platform
            or report.get("candidateSha256") != MANIFEST_SHA256
            or report.get("commit") != COMMIT or report.get("version") != VERSION):
        raise ValueError(f"{platform}: evidence belongs to another candidate")
    for field in ("tester", "testedAt", "osVersion", "codexVersion", "hostId", "sessionId"):
        if not isinstance(report.get(field), str) or not report[field].strip():
            raise ValueError(f"{platform}: missing real-device detail {field}")
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", report["testedAt"]):
        raise ValueError(f"{platform}: testedAt must be UTC ISO timestamp")
    tested_at = datetime.datetime.fromisoformat(report["testedAt"])
    if tested_at > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
        raise ValueError(f"{platform}: test timestamp is in the future")
    if report.get("runningVersion") != VERSION:
        raise ValueError(f"{platform}: tested Host was not running this candidate")
    baseline["verify_official_runtime"](root, platform, report.get("officialRuntime"), report["codexVersion"])
    for check in baseline["CHECKS"]:
        result = report.get("checks", {}).get(check, {})
        if result.get("passed") is not True or not isinstance(result.get("observed"), str) or not result["observed"].strip():
            raise ValueError(f"{platform}: real E2E check not passed: {check}")
    logs = report.get("logs", {})
    if not logs:
        raise ValueError(f"{platform}: missing sanitized E2E evidence files")
    for name, expected in logs.items():
        if baseline["digest"](baseline["safe_file"](evidence, name)) != expected:
            raise ValueError(f"{platform}: E2E evidence changed: {name}")


def verify(root, evidence, current_stable=None):
    require_hash(root / "candidate.json", MANIFEST_SHA256)
    require_hash(root / "release-gate.py", GATE_SHA256)
    require_hash(evidence / "release-waiver-0.4.3.json", WAIVER_SHA256)
    baseline = runpy.run_path(str(root / "release-gate.py"))
    manifest = baseline["validate_candidate"](root)
    if manifest["version"] != VERSION or manifest["commit"] != COMMIT:
        raise ValueError("Outside the authorized 0.4.3 source identity")
    for platform in REQUIRED_PLATFORMS:
        verify_linux(baseline, root, evidence, manifest, platform)
    baseline["check_promotion"](manifest["version"], current_stable)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify",))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--current-stable", type=Path)
    args = parser.parse_args()
    verify(args.directory, args.evidence or args.directory / "evidence", args.current_stable)
    print("0.4.3 identity, integrity and Linux E2E verified; Windows/macOS E2E is explicitly waived, not passed.")


if __name__ == "__main__":
    main()
