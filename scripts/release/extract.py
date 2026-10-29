"""Extract release archives without links, devices, or paths outside the target."""
import sys
import shutil
import tarfile
from pathlib import Path


def extract(archive, destination):
    root = Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as stream:
        members = stream.getmembers()
        for member in members:
            target = (root / member.name).resolve()
            if (target != root and root not in target.parents) or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe release archive entry")
        for member in members:
            target = (root / member.name).resolve()
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with stream.extractfile(member) as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination)


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2])
