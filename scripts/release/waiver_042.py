"""One-time owner-authorized admission of the immutable 0.4.2 candidate.

This does not attest E2E success. gate.py remains the default for other releases.
Only this entry point accepts the exact recorded waiver for the pinned candidate.
"""
import argparse
import hashlib
import runpy
from pathlib import Path

VERSION = "0.4.2"
COMMIT = "c96f94d83b18b7e64cf2348ca35cf480cb5de45f"
MANIFEST_SHA256 = "1f213fbbd222cea56aeba777e4cda06fac063adcfb7b7a70e697beaafc190b02"
ARCHIVE_SHA256 = "e2a4114ebcb8c6fb042d21f50ffc1079bb57d14d16b4c7a9d4fadfdfd2be1dcc"
GATE_SHA256 = "0884055b5afafe6b754fd0564a3a20106b6e4e509e8c9d7ef67b37e4b43621eb"
WAIVER_SHA256 = "33fab5fb661a413c538ff5d616ca8215eb80c0653052ece64f19668b0f80dd0e"


def require_hash(path, expected):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular pinned file: {path.name}")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"Outside the 0.4.2 waiver: {path.name} hash differs")


def verify(root, evidence, current_stable=None):
    require_hash(root / "candidate.json", MANIFEST_SHA256)
    require_hash(root / "release-gate.py", GATE_SHA256)
    require_hash(evidence / "release-waiver-0.4.2.json", WAIVER_SHA256)
    # Execute only the original, hash-pinned gate, never an unverified upload.
    baseline = runpy.run_path(str(root / "release-gate.py"))
    manifest = baseline["validate_candidate"](root)
    if manifest["version"] != VERSION or manifest["commit"] != COMMIT:
        raise ValueError("Outside the authorized 0.4.2 source identity")
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
    print("0.4.2 identity/integrity verified; missing E2E checks admitted by recorded owner waiver.")


if __name__ == "__main__":
    main()
