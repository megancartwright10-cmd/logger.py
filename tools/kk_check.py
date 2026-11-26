import json
from pathlib import Path
blob = json.loads(Path("pqt-cache/Universal--Universal Studios Hollywood.json").read_text())
rows = [r for r in blob["rows"] if "killer klowns" in (r[2] or "").lower() and "2026-10-17" <= r[0] <= "2026-10-21"]
for d, h, name, avg, n in sorted(rows):
    print(f"{d} {int(h):02d}:00  {name}: avg {avg:.0f} min ({n} readings)")
print("nights with Killer Klowns data 17-21 Oct:", sorted({r[0] for r in rows}))
oct19 = [r for r in blob["rows"] if r[0] == "2026-10-19"]
print("any HHN-hour data on 19 Oct at all:", len([r for r in oct19 if int(r[1]) >= 17]), "rows")
