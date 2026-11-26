#!/usr/bin/env python3
"""One-off: busiest times in August from the private Park Queue Times history (pqt-cache/).
Prints summaries only (no raw rows). Hours are park local time."""
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
for path in sorted(Path("pqt-cache").glob("*.json")):
    blob = json.loads(path.read_text())
    rows = [r for r in blob["rows"] if r[0].startswith("2026-08")]
    if not rows:
        continue
    print(f"\n=== {blob['resort']} / {blob['park']}  ({len({r[0] for r in rows})} August days: {min(r[0] for r in rows)} to {max(r[0] for r in rows)})")
    peaks = sorted(rows, key=lambda r: -r[3])[:5]
    print("  Longest single waits (ride, date, hour, average wait that hour):")
    for d, h, name, avg, n in peaks:
        print(f"    {avg:5.0f} min  {name}  {DAYS[date.fromisoformat(d).weekday()]} {d} {int(h):02d}:00")
    by_hour = defaultdict(list); by_day = defaultdict(list); by_ride = defaultdict(list)
    for d, h, name, avg, n in rows:
        by_hour[int(h)].append(avg); by_day[d].append(avg); by_ride[name].append(avg)
    mean = lambda v: sum(v) / len(v)
    h = max(by_hour, key=lambda k: mean(by_hour[k]))
    d = max(by_day, key=lambda k: mean(by_day[k]))
    q = min(by_day, key=lambda k: mean(by_day[k]))
    print(f"  Busiest hour of the day: {h:02d}:00 (avg {mean(by_hour[h]):.0f} min across rides)")
    print(f"  Busiest day: {DAYS[date.fromisoformat(d).weekday()]} {d} (avg {mean(by_day[d]):.0f} min); quietest: {DAYS[date.fromisoformat(q).weekday()]} {q} (avg {mean(by_day[q]):.0f} min)")
    top = sorted(by_ride, key=lambda k: -mean(by_ride[k]))[:3]
    print("  Longest average waits over August: " + "; ".join(f"{k} {mean(by_ride[k]):.0f} min" for k in top))
