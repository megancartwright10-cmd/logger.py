#!/usr/bin/env python3
"""One-off: Halloween Horror Nights waits from the private Park Queue Times history.
HHN houses are spotted as rides that only run on autumn evenings. Summaries only."""
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
for path in sorted(Path("pqt-cache").glob("Universal--*.json")):
    blob = json.loads(path.read_text())
    if blob["park"] not in ("Universal Studios Florida Park", "Universal Studios Hollywood"):
        continue
    by_ride = defaultdict(list)
    for r in blob["rows"]:
        by_ride[r[2]].append(r)
    hhn, ret = [], []
    for name, rows in by_ride.items():
        dates = sorted({r[0] for r in rows})
        evening = sum(1 for r in rows if int(r[1]) >= 17 or int(r[1]) <= 2) / len(rows)
        if "return time" in name.lower():
            ret.append((name, rows))
        elif dates[0] >= "2026-08-20" and dates[-1] <= "2026-11-15" and evening >= 0.85:
            hhn.append((name, rows))
    print(f"\n=== {blob['park']}: {len(hhn)} evening-only autumn attractions (HHN houses), {len(ret)} accessibility return-time entries")
    def show(items, label):
        print(f"  {label}:")
        ranked = sorted(items, key=lambda x: -max(r[3] for r in x[1]))
        for name, rows in ranked[:15]:
            p = max(rows, key=lambda r: r[3])
            nights = len({r[0] for r in rows})
            mean = sum(r[3] for r in rows) / len(rows)
            print(f"    peak {p[3]:4.0f} min  {name}  ({DAYS[date.fromisoformat(p[0]).weekday()]} {p[0]} {int(p[1]):02d}:00; "
                  f"avg {mean:.0f} min over {nights} nights, {min(r[0] for r in rows)} to {max(r[0] for r in rows)})")
    show(hhn, "Houses by longest standby wait")
    if ret:
        show(ret, "Accessibility return times (not standby queues)")
    if hhn:
        nights = defaultdict(list)
        for _, rows in hhn:
            for r in rows:
                nights[r[0]].append(r[3])
        top = sorted(nights, key=lambda d: -sum(nights[d]) / len(nights[d]))[:5]
        print("  Busiest HHN nights (avg wait across houses): " + "; ".join(
            f"{DAYS[date.fromisoformat(d).weekday()]} {d} {sum(nights[d])/len(nights[d]):.0f} min" for d in top))
