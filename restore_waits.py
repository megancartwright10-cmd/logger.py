#!/usr/bin/env python3
"""
Puts archived wait readings back into data/YYYY-MM/<resort>--<park>.csv.

Since 11 Nov 2026 the logger no longer saves readings into the repository (that
would make it grow by about 1 GB a year). Each hour's readings are uploaded as a
small .tar.gz to a GitHub Release called waits-YYYY-MM instead. The app data job
downloads the recent ones and runs this to merge them before building.

Usage: python3 restore_waits.py <folder with .tar.gz files>
Uses only the Python standard library.
"""
import csv
import sys
import tarfile
from pathlib import Path

DATA = Path("data")


def merge(archive_dir):
    archives = sorted(Path(archive_dir).glob("*.tar.gz"))
    added = 0
    for arc in archives:
        try:
            with tarfile.open(arc, "r:gz") as tar:
                for member in tar.getmembers():
                    name = member.name.lstrip("./")
                    parts = Path(name).parts
                    # only data/YYYY-MM/<file>.csv, nothing else, no odd paths
                    if (not member.isfile() or len(parts) != 3 or parts[0] != "data"
                            or not parts[2].endswith(".csv") or ".." in parts):
                        continue
                    f = tar.extractfile(member)
                    if f is None:
                        continue
                    rows = list(csv.reader(line.decode("utf-8") for line in f))
                    if len(rows) < 2:
                        continue
                    target = DATA / parts[1] / parts[2]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    new = not target.exists()
                    with target.open("a", newline="", encoding="utf-8") as out:
                        w = csv.writer(out)
                        if new:
                            w.writerow(rows[0])
                        w.writerows(rows[1:])
                    added += len(rows) - 1
        except (tarfile.TarError, OSError, UnicodeDecodeError) as e:
            print(f"  skipped {arc.name}: {e}")
    print(f"Merged {added} readings from {len(archives)} archives")


if __name__ == "__main__":
    merge(sys.argv[1] if len(sys.argv) > 1 else "archives")
