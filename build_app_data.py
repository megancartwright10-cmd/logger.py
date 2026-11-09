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

# Areas ("lands"), listed in rough walking order round each park.
# The live feed doesn't say which land a ride is in, so it's kept here.
LANDS = {
    "Disneyland Park": {
        "Main Street, U.S.A.": [
            "Disneyland Railroad", "Main Street Vehicles", "Main Street Cinema",
            "Great Moments with Mr. Lincoln", "Opera House - Walt Disney - A Magical Life",
            "Walt Disney - A Magical Life", "The Disney Gallery", "Fortune Tellers"],
        "Adventureland": [
            "Indiana Jones™ Adventure", "Jungle Cruise", "Walt Disney's Enchanted Tiki Room",
            "Adventureland Treehouse inspired by Walt Disney’s Swiss Family Robinson"],
        "New Orleans Square": ["Pirates of the Caribbean", "Haunted Mansion Holiday", "Haunted Mansion"],
        "Bayou Country": [
            "Tiana's Bayou Adventure", "The Many Adventures of Winnie the Pooh",
            "Davy Crockett's Explorer Canoes"],
        "Frontierland": [
            "Big Thunder Mountain Railroad", "Mark Twain Riverboat", "Sailing Ship Columbia",
            "Pirate's Lair on Tom Sawyer Island", "Frontierland Shootin' Exposition"],
        "Star Wars: Galaxy's Edge": [
            "Star Wars: Rise of the Resistance", "Millennium Falcon: Smugglers Run"],
        "Fantasyland": [
            "Matterhorn Bobsleds", "Peter Pan's Flight", "Alice in Wonderland", "Mr. Toad's Wild Ride",
            "Snow White's Enchanted Wish", "Pinocchio's Daring Journey", "Dumbo the Flying Elephant",
            "Mad Tea Party", "King Arthur Carrousel", "Casey Jr. Circus Train", "Storybook Land Canal Boats",
            "\"it's a small world\"", "Sleeping Beauty Castle Walkthrough",
            "Bluey’s Best Day Ever! at Fantasyland Theatre"],
        "Mickey's Toontown": [
            "Mickey & Minnie's Runaway Railway", "Roger Rabbit's Car Toon Spin",
            "Chip 'n' Dale's GADGETcoaster", "Goofy's How-to-Play Yard", "Minnie's House",
            "Donald's Duck Pond"],
        "Tomorrowland": [
            "Space Mountain", "Star Tours - The Adventures Continue", "Buzz Lightyear Astro Blasters",
            "Finding Nemo Submarine Voyage", "Autopia", "Astro Orbitor", "Disneyland Monorail",
            "Pixar Short Film Spotlight"],
    },
    "Disney California Adventure Park": {
        "Hollywood Land": [
            "Monsters, Inc. Mike & Sulley to the Rescue!", "Mickey's PhilharMagic", "Animation Academy",
            "Sorcerer's Workshop", "Turtle Talk with Crush"],
        "Avengers Campus": [
            "Guardians of the Galaxy - Mission: BREAKOUT!", "WEB SLINGERS: A Spider-Man Adventure"],
        "Cars Land": [
            "Radiator Springs Racers", "Luigi's Rollickin' Roadsters", "Mater's Junkyard Jamboree"],
        "San Fransokyo Square": ["The Bakery Tour"],
        "Pixar Pier": [
            "Incredicoaster", "Toy Story Midway Mania!", "Inside Out Emotional Whirlwind",
            "Jessie's Critter Carousel", "Pixar Pal-A-Round - Swinging", "Pixar Pal-A-Round – Non-Swinging",
            "Games of Pixar Pier"],
        "Paradise Gardens Park": [
            "The Little Mermaid - Ariel's Undersea Adventure", "Goofy's Sky School", "Silly Symphony Swings",
            "Golden Zephyr", "Jumpin' Jellyfish"],
        "Grizzly Peak": ["Soarin’ Across America", "Soarin' Around the World", "Grizzly River Run",
                         "Redwood Creek Challenge Trail"],
    },
}


def land_lookup(park_name):
    """ride name -> (land, order of that land in the park)"""
    out = {}
    for i, (land, rides) in enumerate(LANDS.get(park_name, {}).items()):
        for r in rides:
            out[" ".join(r.split())] = (land, i)
    return out
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
                dow = (local.weekday() + 1) % 7  # 0 = Sunday, like JavaScript
                buckets[(row["ride_id"], day, local.hour)].append(wait)
                buckets[(row["ride_id"], dow, local.hour)].append(wait)
    out = defaultdict(lambda: {"weekday": [None] * 24, "weekend": [None] * 24,
                               "dow": [[None] * 24 for _ in range(7)]})
    for (ride, day, hour), waits in buckets.items():
        if len(waits) < MIN_SAMPLES:
            continue
        value = round(statistics.median(waits))
        if isinstance(day, int):
            out[ride]["dow"][day][hour] = value
        else:
            out[ride][day][hour] = value
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
            lands = land_lookup(park_name)
            rides = []
            for k in kids:
                if k.get("entityType") != "ATTRACTION":
                    continue
                land, order = lands.get(" ".join((k.get("name") or "").split()), ("Other", 99))
                if land == "Other":
                    print(f"  no land for: {k.get('name')}")
                rides.append({"id": k["id"], "name": k.get("name"), "land": land, "landOrder": order,
                              "loc": location_of(k["id"], cache),
                              "typical": history.get(k["id"])})
            food = []
            for rid, t in tags.items():
                if t["resort"] == resort and t["park"] == park_name \
                        and t["service"] in ("quick", "snack", "table"):
                    food.append({"id": rid, "name": t["name"], "service": t["service"],
                                 "moods": t["moods"], "loc": location_of(rid, cache)})
            rides.sort(key=lambda r: (r["landOrder"], (r["name"] or "").strip('"').lower()))
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
