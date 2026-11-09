#!/usr/bin/env python3
"""
One-off: saves every restaurant listed by ThemeParks.wiki for the same
resorts the wait-time logger covers, to data/restaurants.json.
Restaurants inside a park get that park's name; the rest (hotels,
Disney Springs, CityWalk, Downtown Disney...) are marked "Outside parks".
Uses logger.py's helpers, so nothing extra to install.
"""
import json
import sys
from pathlib import Path

from logger import fetch, find_parks, TARGETS

OUT = Path("data") / "restaurants.json"


def restaurants_under(entity_id):
    kids = fetch(f"/entity/{entity_id}/children").get("children", [])
    return [k for k in kids if k.get("entityType") == "RESTAURANT"]


def main():
    parks, missing = find_parks()
    if missing:
        sys.exit(1)

    rows, seen = [], set()
    for park_id, park_name, resort in parks:
        for r in restaurants_under(park_id):
            seen.add(r["id"])
            rows.append({"id": r["id"], "name": r.get("name"), "resort": resort,
                         "park": park_name, "slug": r.get("slug")})
        print(f"{resort} / {park_name}: done")

    # Restaurants elsewhere in each resort (hotels, shopping districts)
    destinations = fetch("/destinations").get("destinations", [])
    for label, rule in TARGETS.items():
        for d in destinations:
            if not rule((d.get("name") or "").lower(), (d.get("slug") or "").lower()):
                continue
            for r in restaurants_under(d["id"]):
                if r["id"] in seen:
                    continue
                seen.add(r["id"])
                rows.append({"id": r["id"], "name": r.get("name"), "resort": label,
                             "park": "Outside parks", "slug": r.get("slug")})

    rows.sort(key=lambda x: (x["resort"], x["park"], x["name"] or ""))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {len(rows)} restaurants to {OUT}")


if __name__ == "__main__":
    main()
