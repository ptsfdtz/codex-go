"""One-time owner-authorized admission of the immutable 0.4.4 candidate.

This does not attest E2E success. gate.py remains the default for other releases.
Only this entry point accepts the exact recorded waiver for the pinned candidate.
"""
import argparse
import hashlib
import runpy
from pathlib import Path

VERSION = "0.4.4"
COMMIT = "8b037af4c85e131d676c33d502801d9b26033014"
MANIFEST_SHA256 = "1c974e4bdfb23fc2a85d7d3dccb169dcc08f811563ccbaef608bdc77834ea371"
ARCHIVE_SHA256 = "892322dc492cea7adf4e3513f1f290e131859901e3d32f081bd333fc590ad10d"
GATE_SHA256 = "0884055b5afafe6b754fd0564a3a20106b6e4e509e8c9d7ef67b37e4b43621eb"
WAIVER_SHA256 = "620d98758fe2b1ff17e929ff809e2a71a9bc34f4fd510b8c16e68f00cf786ae8"


def require_hash(path, expected):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular pinned file: {path.name}")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"Outside the 0.4.4 waiver: {path.name} hash differs")


def verify(root, evidence, current_stable=None):
    require_hash(root / "candidate.json", MANIFEST_SHA256)
    require_hash(root / "release-gate.py", GATE_SHA256)
    require_hash(evidence / "release-waiver-0.4.4.json", WAIVER_SHA256)
    # Execute only the original, hash-pinned gate, never an unverified upload.
    baseline = runpy.run_path(str(root / "release-gate.py"))
    manifest = baseline["validate_candidate"](root)
    if manifest["version"] != VERSION or manifest["commit"] != COMMIT:
        raise ValueError("Outside the authorized 0.4.4 source identity")
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
    print("0.4.4 identity/integrity verified; missing E2E checks admitted by recorded owner waiver.")


if __name__ == "__main__":
    main()
