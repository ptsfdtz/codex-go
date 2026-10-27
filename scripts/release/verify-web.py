"""Check deployed Web bytes through the public HTTPS origin."""
import hashlib
import ssl
import sys
import json
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(sys.argv[1])
origin = sys.argv[2].rstrip("/")
if urllib.parse.urlsplit(origin).scheme != "https":
    raise ValueError("HTTPS origin required")
if len(sys.argv) <= 3:
    for endpoint in ("/health/live", "/health/ready"):
        url = origin + endpoint
        with urllib.request.urlopen(url, timeout=30, context=ssl.create_default_context()) as response:
            if response.status != 200 or response.geturl() != url or json.load(response).get("ok") is not True:
                raise ValueError(f"Cloud health check failed: {endpoint}")
paths = sorted(root.rglob("*"))
if len(sys.argv) > 3 and sys.argv[3] == "--downloads":
    manifest = json.loads((root / "candidate.json").read_text(encoding="utf-8"))
    paths = [root / name for name in manifest["artifacts"] if name.startswith(f"releases/{manifest['version']}/")]
for path in paths:
    if path.is_file():
        name = path.relative_to(root).as_posix()
        request = urllib.request.Request(origin + "/" + urllib.parse.quote(name), headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=30, context=ssl.create_default_context()) as response:
            if response.status != 200 or response.geturl() != request.full_url:
                raise ValueError(f"Unexpected public response: {name}")
            actual = hashlib.file_digest(response, "sha256").hexdigest()
        if actual != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError(f"Online Web integrity failure: {name}")
