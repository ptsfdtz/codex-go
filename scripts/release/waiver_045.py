"""One-time owner-authorized admission of the immutable 0.4.5 candidate.

This does not attest E2E success. gate.py remains the default for other releases.
Only this entry point accepts the exact recorded waiver for the pinned candidate.
"""
import argparse
import hashlib
import runpy
from pathlib import Path

VERSION = "0.4.5"
COMMIT = "6cf8c529478b2c591a7bd8162d9662efb1c42b86"
MANIFEST_SHA256 = "234dbe501ced3d146a7e6db63afa3b7b6117e86b921cc9f4492e459ea04ef2b0"
ARCHIVE_SHA256 = "05ae5799badfb9b53eb0f66346003d7e9f58948c52b2a58c1ba825736e7dc19c"
GATE_SHA256 = "d73cbb178a6b5f6e7a6a3baabd08cfa5a570a821e38faa765ebb461affca807c"
WAIVER_SHA256 = "19654dfd0f81fb2511e186a0e7fca7b079f600e13564ff01f8ceaf95850f0e77"


def require_hash(path, expected):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular pinned file: {path.name}")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"Outside the 0.4.5 waiver: {path.name} hash differs")


def verify(root, evidence, current_stable=None):
    require_hash(root / "candidate.json", MANIFEST_SHA256)
    require_hash(root / "release-gate.py", GATE_SHA256)
    require_hash(evidence / "release-waiver-0.4.5.json", WAIVER_SHA256)
    # Execute only the original, hash-pinned gate, never an unverified upload.
    baseline = runpy.run_path(str(root / "release-gate.py"))
    manifest = baseline["validate_candidate"](root)
    if manifest["version"] != VERSION or manifest["commit"] != COMMIT:
        raise ValueError("Outside the authorized 0.4.5 source identity")
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
    print("0.4.5 identity/integrity verified; missing E2E checks admitted by recorded owner waiver.")


if __name__ == "__main__":
    main()
