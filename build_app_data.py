#!/usr/bin/env python3
"""
Builds the small data file the phone app downloads:
  data/app/<resort-slug>.json

For each resort in APP_RESORTS it includes:
  - parks (live-data IDs) and the park's current UTC offset
  - rides with map coordinates (for walking times)
  - quick-service / snack restaurants with coordinates and food-mood tags
  - "typical" standby waits per ride, by hour of day, split weekday/weekend,
    worked out from everything the wait logger has saved so far

Runs nightly from GitHub Actions. Standard library only.
"""
import csv
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from logger import fetch, find_parks, slugify

APP_RESORTS = {"Disneyland Resort": "America/Los_Angeles"}
DATA = Path("data")
MIN_SAMPLES = 3          # readings needed before we trust an hour's typical wait


def location_of(entity_id, cache):
    if entity_id in cache:
        return cache[entity_id]
    loc = None
    try:
        e = fetch(f"/entity/{entity_id}")
        l = e.get("location") or {}
        if l.get("latitude") is not None and l.get("longitude") is not None:
            loc = [round(float(l["latitude"]), 6), round(float(l["longitude"]), 6)]
    except Exception as ex:  # one bad entity shouldn't stop the build
        print(f"  no location for {entity_id}: {ex}")
    cache[entity_id] = loc
    return loc


def typical_waits(resort, tz):
    """median standby wait per ride, per (weekday|weekend), per local hour"""
    buckets = defaultdict(list)
    files = sorted(DATA.glob(f"*/{slugify(resort)}--*.csv"))
    for path in files:
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("status") != "OPERATING" or not row.get("standby_wait"):
                    continue
                try:
                    t = datetime.strptime(row["timestamp_utc"], "%Y-%m-%dT%H:%MZ")
                    wait = int(float(row["standby_wait"]))
                except ValueError:
                    continue
                local = t.replace(tzinfo=timezone.utc).astimezone(tz)
                day = "weekend" if local.weekday() >= 5 else "weekday"
                buckets[(row["ride_id"], day, local.hour)].append(wait)
    out = defaultdict(lambda: {"weekday": [None] * 24, "weekend": [None] * 24})
    for (ride, day, hour), waits in buckets.items():
        if len(waits) >= MIN_SAMPLES:
            out[ride][day][hour] = round(statistics.median(waits))
    print(f"  history from {len(files)} files, {len(out)} rides with enough readings")
    return out


def main():
    parks, missing = find_parks()
    tags = json.loads((DATA / "restaurant-tags.json").read_text(encoding="utf-8"))
    cache_path = DATA / "app" / "locations-cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    for resort, tz_name in APP_RESORTS.items():
        tz = ZoneInfo(tz_name)
        offset = int(datetime.now(tz).utcoffset().total_seconds() // 60)
        history = typical_waits(resort, tz)
        out = {"resort": resort, "timezone": tz_name, "utcOffsetMinutes": offset,
               "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
               "parks": []}
        for park_id, park_name, label in parks:
            if label != resort:
                continue
            kids = fetch(f"/entity/{park_id}/children").get("children", [])
            rides = []
            for k in kids:
                if k.get("entityType") != "ATTRACTION":
                    continue
                rides.append({"id": k["id"], "name": k.get("name"),
                              "loc": location_of(k["id"], cache),
                              "typical": history.get(k["id"])})
            food = []
            for rid, t in tags.items():
                if t["resort"] == resort and t["park"] == park_name \
                        and t["service"] in ("quick", "snack", "table"):
                    food.append({"id": rid, "name": t["name"], "service": t["service"],
                                 "moods": t["moods"], "loc": location_of(rid, cache)})
            rides.sort(key=lambda r: r["name"] or "")
            food.sort(key=lambda r: r["name"])
            out["parks"].append({"id": park_id, "name": park_name,
                                 "rides": rides, "food": food})
            print(f"{park_name}: {len(rides)} rides, {len(food)} places to eat")

        target = DATA / "app" / f"{slugify(resort)}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                          encoding="utf-8")
        print(f"Wrote {target} ({target.stat().st_size // 1024} KB)")

    cache_path.write_text(json.dumps(cache, separators=(",", ":")))
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
