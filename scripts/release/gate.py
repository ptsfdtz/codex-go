"""Candidate identity and real-device E2E attestations. Standard library only.

An attestation records a tester's observed results; this tool never substitutes
static checks or a generated transcript for a real E2E run.
"""
import argparse
import hashlib
import json
import re
import datetime
import platform as system_platform
import subprocess
import sys
from pathlib import Path

PLATFORMS = ("windows-x64", "linux-x64", "linux-arm64", "macos-arm64")
CHECKS = ("installUpgrade", "remoteConnection", "realModelHistory",
          "projectSandboxApproval", "restartReconnect", "changedFeatures")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load(path):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError(f"Oversized metadata: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def safe_file(root, name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("Invalid artifact path")
    path = root / name
    if path.is_symlink() or root.resolve() not in path.resolve().parents:
        raise ValueError("Artifact escapes candidate directory")
    return path


def validate_candidate(root):
    manifest = load(root / "candidate.json")
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported candidate schema")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", manifest.get("version", "")):
        raise ValueError("Expected a public X.Y.Z version")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("commit", "")):
        raise ValueError("Missing exact source commit")
    artifacts = manifest.get("artifacts", {})
    required = {f"releases/{manifest['version']}/agentdeck-{p}."
                + ("zip" if p.startswith("windows") else "tar.gz") for p in PLATFORMS}
    required.update(("web.tar.gz", "pages.tar.gz", "agentdeck-cloud", "install.ps1",
                     "install.sh", "install-codex.ps1", "releases/stable.txt", "release-gate.py"))
    required.add(f"releases/{manifest['version']}/notes.txt")
    for target in PLATFORMS:
        archive = f"releases/{manifest['version']}/agentdeck-{target}." + ("zip" if target.startswith("windows") else "tar.gz")
        required.update((archive + ".sha256", f"releases/{manifest['version']}/{target}.json"))
    if not required.issubset(artifacts):
        raise ValueError("Candidate is missing required platform/component artifacts")
    for name, expected in artifacts.items():
        if not re.fullmatch(r"[0-9a-f]{64}", str(expected)) or digest(safe_file(root, name)) != expected:
            raise ValueError(f"Candidate integrity failure: {name}")
    if (root / "releases/stable.txt").read_text(encoding="utf-8").strip() != manifest["version"]:
        raise ValueError("Stable pointer differs from candidate version")
    for target in PLATFORMS:
        archive = f"releases/{manifest['version']}/agentdeck-{target}." + ("zip" if target.startswith("windows") else "tar.gz")
        if (root / (archive + ".sha256")).read_text(encoding="utf-8").strip() != artifacts[archive]:
            raise ValueError(f"Invalid installer checksum: {target}")
        metadata = load(root / f"releases/{manifest['version']}/{target}.json")
        os_name, arch = target.split("-")
        if metadata != {"version": manifest["version"], "platform": os_name, "arch": arch,
                        "file": Path(archive).name, "sha256": artifacts[archive]}:
            raise ValueError(f"Invalid platform metadata: {target}")
    return manifest


def verify(root, evidence):
    manifest = validate_candidate(root)
    identity = digest(root / "candidate.json")
    for platform in PLATFORMS:
        report = load(evidence / f"{platform}.json")
        if (report.get("schemaVersion") != 1 or report.get("platform") != platform
                or report.get("candidateSha256") != identity
                or report.get("commit") != manifest["commit"]
                or report.get("version") != manifest["version"]):
            raise ValueError(f"{platform}: evidence belongs to another candidate")
        for field in ("tester", "testedAt", "osVersion", "codexVersion", "hostId", "sessionId"):
            if not isinstance(report.get(field), str) or not report[field].strip():
                raise ValueError(f"{platform}: missing real-device detail {field}")
        if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", report["testedAt"]):
            raise ValueError(f"{platform}: testedAt must be UTC ISO timestamp")
        tested_at = datetime.datetime.fromisoformat(report["testedAt"])
        if tested_at > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
            raise ValueError(f"{platform}: test timestamp is in the future")
        if report.get("runningVersion") != manifest["version"]:
            raise ValueError(f"{platform}: tested Host was not running this candidate")
        for check in CHECKS:
            result = report.get("checks", {}).get(check, {})
            if result.get("passed") is not True or not isinstance(result.get("observed"), str) or not result["observed"].strip():
                raise ValueError(f"{platform}: real E2E check not passed: {check}")
        logs = report.get("logs", {})
        if not logs:
            raise ValueError(f"{platform}: missing sanitized E2E evidence files")
        for name, expected in logs.items():
            if digest(safe_file(evidence, name)) != expected:
                raise ValueError(f"{platform}: E2E evidence changed: {name}")
    return manifest


def recorded_platform():
    machine = system_platform.machine().lower()
    arch = "arm64" if machine in ("aarch64", "arm64") else "x64" if machine in ("amd64", "x86_64") else "unsupported"
    if sys.platform == "win32":
        system = "windows"
    elif sys.platform == "darwin":
        system = "macos"
    else:
        system = sys.platform
    return system + "-" + arch


def check_promotion(version, current_stable):
    if current_stable is None or not current_stable.exists():
        return
    current = current_stable.read_text(encoding="utf-8").strip()
    if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", current):
        if tuple(map(int, version.split("."))) < tuple(map(int, current.split("."))):
            raise ValueError("Refusing to promote an older candidate over the current stable release")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("manifest", "template", "record", "verify", "verify-candidate"))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--commit")
    parser.add_argument("--notes-file", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--platform", choices=PLATFORMS)
    parser.add_argument("--agentdeck", default="agentdeck", help="Installed candidate CLI path for live status capture")
    parser.add_argument("--current-stable", type=Path)
    args = parser.parse_args()
    root = args.directory
    if args.command == "manifest":
        if not args.version or not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", args.version):
            parser.error("Expected a public X.Y.Z version")
        if args.notes_file is None:
            parser.error("--notes-file is required")
        notes = args.notes_file.read_text(encoding="utf-8").strip()
        if not notes or len(notes.encode("utf-8")) > 16000:
            parser.error("Release notes must contain 1..16000 UTF-8 bytes")
        (root / f"releases/{args.version}/notes.txt").write_text(notes + "\n", encoding="utf-8")
        artifacts = {p.relative_to(root).as_posix(): digest(p)
                     for p in sorted(root.rglob("*")) if p.is_file() and p.name != "candidate.json"}
        (root / "candidate.json").write_text(json.dumps({"schemaVersion": 1,
            "version": args.version, "commit": args.commit, "artifacts": artifacts},
            indent=2) + "\n", encoding="utf-8")
        validate_candidate(root)
    elif args.command == "template":
        manifest = validate_candidate(root)
        if args.evidence is None:
            parser.error("--evidence is required")
        args.evidence.mkdir(parents=True, exist_ok=True)
        for platform in PLATFORMS:
            path = args.evidence / f"{platform}.json"
            if path.exists():
                raise ValueError(f"Will not overwrite existing evidence: {path}")
            path.write_text(json.dumps({"schemaVersion": 1, "platform": platform,
                "candidateSha256": digest(root / "candidate.json"), **{k: manifest[k] for k in ("version", "commit")},
                **{k: "" for k in ("tester", "testedAt", "osVersion", "codexVersion", "hostId", "sessionId", "runningVersion")},
                "checks": {c: {"passed": False, "observed": ""} for c in CHECKS},
                "logs": {}}, indent=2) + "\n", encoding="utf-8")
    elif args.command == "record":
        manifest = validate_candidate(root)
        if args.evidence is None or args.platform is None:
            parser.error("--evidence and --platform are required")
        if recorded_platform() != args.platform:
            raise ValueError("Record evidence on the actual matching Windows/Linux/macOS device")
        path = args.evidence / f"{args.platform}.json"
        report = load(path)
        state = json.loads(subprocess.check_output([args.agentdeck, "status", "--json"], timeout=30, encoding="utf-8"))
        if (state.get("runningVersion") != manifest["version"] or not state.get("codexReady")
                or not state.get("cloud", {}).get("online") or state.get("runtimeError") is not None
                or not state.get("sandboxVerified")):
            raise ValueError("Live candidate Host, cloud and verified Codex must be ready")
        if report.get("candidateSha256") != digest(root / "candidate.json"):
            raise ValueError("Report belongs to another candidate")
        # Explicitly completed observations remain the tester's responsibility.
        # Capture live identity and hash the already sanitized evidence files.
        report.update({"runningVersion": state["runningVersion"], "hostId": state["hostId"],
                       "codexVersion": state["codexVersion"], "osVersion": system_platform.platform(),
                       "testedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        logs = report.get("logs", {})
        if not logs:
            raise ValueError("Add sanitized evidence filenames to logs before recording")
        report["logs"] = {name: digest(safe_file(args.evidence, name)) for name in logs}
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    elif args.command == "verify-candidate":
        validate_candidate(root)
    else:
        manifest = verify(root, args.evidence or root / "evidence")
        check_promotion(manifest["version"], args.current_stable)


if __name__ == "__main__":
    main()
