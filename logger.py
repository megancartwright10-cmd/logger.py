#!/usr/bin/env python3
"""
Logs live ride wait times from the free ThemeParks.wiki API for every Disney and
Universal park in the world, plus Merlin Entertainments parks:
  Disney:    Walt Disney World, Disneyland Resort, Disneyland Paris, Tokyo Disney Resort,
             Hong Kong Disneyland, Shanghai Disney Resort
  Universal: Universal Orlando, Universal Studios Hollywood, Universal Studios Japan,
             Universal Studios Singapore, Universal Beijing Resort
  Merlin:    Alton Towers, Thorpe Park, Chessington, Gardaland, Heide Park, Peppa Pig Theme Park,
             LEGOLAND Windsor, Billund, Deutschland, California, Florida, New York, Japan, Korea
Writes one CSV per park per month: data/YYYY-MM/<resort>--<park>.csv
Uses only the Python standard library (nothing to install).
"""
import csv
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.themeparks.wiki/v1"
DATA_DIR = Path("data")

# Which resorts to log. Each rule checks a destination's name/slug.
TARGETS = {
    # Disney
    "Walt Disney World": lambda n, s: "walt disney world" in n,
    "Disneyland Resort": lambda n, s: "disneyland resort" in n,
    "Disneyland Paris": lambda n, s: "disneyland paris" in n,
    "Tokyo Disney Resort": lambda n, s: s == "tdr" or "tokyo disney" in n,
    "Hong Kong Disneyland": lambda n, s: "hong kong disneyland" in n,
    "Shanghai Disney Resort": lambda n, s: "shanghai disney" in n,
    # Universal
    "Universal Orlando": lambda n, s: "universal orlando" in n,
    "Universal Studios Hollywood": lambda n, s: ("universal" in n and "hollywood" in n)
    or s == "universalstudios",
    "Universal Studios Japan": lambda n, s: "universal studios japan" in n,
    "Universal Studios Singapore": lambda n, s: "universal studios singapore" in n,
    "Universal Beijing Resort": lambda n, s: "universal beijing" in n,
    # Merlin Entertainments
    "Alton Towers": lambda n, s: "alton towers" in n,
    "Thorpe Park": lambda n, s: "thorpe park" in n,
    "Chessington World of Adventures": lambda n, s: "chessington" in n,
    "Gardaland": lambda n, s: n == "gardaland" or s == "gardalandresort",
    "Heide Park": lambda n, s: "heide park" in n,
    "Peppa Pig Theme Park": lambda n, s: "peppa pig theme park" in n,
    "LEGOLAND Windsor": lambda n, s: "legoland windsor" in n,
    "LEGOLAND Billund": lambda n, s: "legoland billund" in n,
    "LEGOLAND Deutschland": lambda n, s: "legoland deutschland" in n,
    "LEGOLAND California": lambda n, s: "legoland california" in n,
    "LEGOLAND Florida": lambda n, s: "legoland florida" in n,
    "LEGOLAND New York": lambda n, s: "legoland new york" in n,
    "LEGOLAND Japan": lambda n, s: "legoland japan" in n,
    "LEGOLAND Korea": lambda n, s: "legoland" in n and "korea" in n,
}

COLUMNS = [
    "timestamp_utc", "resort", "park", "ride_id", "ride_name", "status",
    "standby_wait", "single_rider_wait",
    "return_time_state", "return_time_start",
    "paid_return_state", "paid_return_start", "paid_return_price",
    "source_last_updated",
]


def fetch(path, retries=3):
    url = f"{API}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "personal-wait-logger/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retrying {url} ({e})")
            time.sleep(3 * (attempt + 1))


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def queue_value(queue, kind, field):
    return (queue.get(kind) or {}).get(field)


def price_text(queue):
    price = queue_value(queue, "PAID_RETURN_TIME", "price") or {}
    if price.get("amount") is None:
        return None
    return f"{price['amount']} {price.get('currency', '')}".strip()


def find_parks():
    destinations = fetch("/destinations").get("destinations", [])
    parks, missing = [], []
    for label, rule in TARGETS.items():
        hits = [d for d in destinations
                if rule((d.get("name") or "").lower(), (d.get("slug") or "").lower())]
        if not hits:
            missing.append(label)
        for d in hits:
            for p in d.get("parks", []):
                parks.append((p["id"], p["name"], label))
                print(f"Found: {label} -> {p['name']}")
    if missing:
        print("\nWARNING: couldn't find:", ", ".join(missing))
        print("Destinations available:")
        for d in destinations:
            print(f"  {d.get('name')}  (slug: {d.get('slug')})")
    return parks, missing


def log_park(park_id, park_name, resort, now):
    live = fetch(f"/entity/{park_id}/live").get("liveData", [])
    rows = []
    for e in live:
        if e.get("entityType") != "ATTRACTION":
            continue
        status = e.get("status")
        if status == "CLOSED":  # skip overnight/closed rows to keep files small
            continue
        q = e.get("queue") or {}
        rows.append({
            "timestamp_utc": now,
            "resort": resort,
            "park": park_name,
            "ride_id": e.get("id"),
            "ride_name": e.get("name"),
            "status": status,
            "standby_wait": queue_value(q, "STANDBY", "waitTime"),
            "single_rider_wait": queue_value(q, "SINGLE_RIDER", "waitTime"),
            "return_time_state": queue_value(q, "RETURN_TIME", "state"),
            "return_time_start": queue_value(q, "RETURN_TIME", "returnStart"),
            "paid_return_state": queue_value(q, "PAID_RETURN_TIME", "state"),
            "paid_return_start": queue_value(q, "PAID_RETURN_TIME", "returnStart"),
            "paid_return_price": price_text(q),
            "source_last_updated": e.get("lastUpdated"),
        })
    if not rows:
        return 0
    month = now[:7]
    out = DATA_DIR / month / f"{slugify(resort)}--{slugify(park_name)}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    is_new = not out.exists()
    with out.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        if is_new:
            w.writeheader()
        w.writerows(rows)
    return len(rows)


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    parks, missing = find_parks()
    failures = 0
    for park_id, park_name, resort in parks:
        try:
            n = log_park(park_id, park_name, resort, now)
            print(f"{resort} / {park_name}: {n} rows")
        except Exception as e:
            failures += 1
            print(f"ERROR {resort} / {park_name}: {e}")
    # Non-zero exit makes GitHub email you so problems don't go unnoticed.
    if missing or (parks and failures == len(parks)) or not parks:
        sys.exit(1)


if __name__ == "__main__":
    main()
