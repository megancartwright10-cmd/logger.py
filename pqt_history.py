#!/usr/bin/env python3
"""
Downloads the last 90 days of hourly ride waits from Park Queue Times
(paid Developer plan) for the parks in the app.

The raw data is NOT committed: this repo is public, and republishing Park Queue
Times' raw data needs their Enterprise licence. It's saved to pqt-cache/, which
GitHub Actions keeps in its private build cache. build_app_data.py only
publishes the typical waits worked out from it.

Needs the PQT_KEY environment variable (a GitHub secret). Without it, does nothing.
Fetches at most once a day; later builds that day reuse the cache.
Standard library only.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API = "https://api.parkqueuetimes.com/v1"
CACHE = Path("pqt-cache")
DAYS = 90
WINDOW = 31  # longest hourly window the API allows per request

# our park name -> (timezone, other names Park Queue Times might use)
PARKS = {
    "Disneyland Resort": {
        "Disneyland Park": ("America/Los_Angeles", []),
        "Disney California Adventure Park": ("America/Los_Angeles", ["California Adventure"]),
    },
    "Disneyland Paris": {
        "Disneyland Park": ("Europe/Paris", ["Disneyland Paris"]),
        # Disney Adventure World: not in Park Queue Times (Nov 2026), so it uses our own logs only
    },
    "Walt Disney World": {
        "Magic Kingdom Park": ("America/New_York", ["Magic Kingdom"]),
        "EPCOT": ("America/New_York", []),
        "Disney's Hollywood Studios": ("America/New_York", ["Hollywood Studios"]),
        "Disney's Animal Kingdom Theme Park": ("America/New_York", ["Animal Kingdom"]),
    },
}


def key_name(text):
    """loose name for matching: 'Disney's Animal Kingdom Theme Park' -> 'animal kingdom'"""
    t = (text or "").lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    drop = {"disney", "disneys", "s", "the", "theme", "park", "walt", "resort"}
    return " ".join(w for w in t.split() if w not in drop)


def get(path, params=None):
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, headers={"x-api-key": os.environ["PQT_KEY"],
                                               "user-agent": "ride-next-build"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = {}
            try:
                body = json.load(e)
            except Exception:
                pass
            code = body.get("code")
            if e.code in (429, 503) and code != "DAILY_LIMIT_EXCEEDED" and attempt < 4:
                wait = int(e.headers.get("Retry-After") or 10)
                print(f"  {code or e.code}: waiting {wait}s")
                time.sleep(min(wait, 120))
                continue
            raise RuntimeError(f"{e.code} {code}: {body.get('error')}") from None
    raise RuntimeError("gave up after retries")


def find_pqt_parks():
    """(resort, our park name) -> Park Queue Times park id"""
    listing = get("/parks").get("data") or []
    found = {}
    for resort, parks in PARKS.items():
        for name, (tz, aliases) in parks.items():
            wanted = {key_name(n) for n in [name, *aliases]}
            hits = [p for p in listing if p.get("timezone") == tz and key_name(p.get("name")) in wanted]
            if hits:
                found[(resort, name)] = hits[0]["id"]
                print(f"  {resort} / {name} -> {hits[0]['name']} (id {hits[0]['id']})")
            else:
                same_tz = [p.get("name") for p in listing if p.get("timezone") == tz]
                print(f"  NOT FOUND: {resort} / {name}. Parks in {tz}: {same_tz}")
    return found


SHOWN = set()


def shape(x, depth=0):
    """the layout of a reply without any values, for the build log"""
    if depth > 3:
        return "…"
    if isinstance(x, dict):
        return {k: shape(v, depth + 1) for k, v in list(x.items())[:12]}
    if isinstance(x, list):
        return [shape(x[0], depth + 1)] if x else []
    return type(x).__name__


def flat_rows(data, inherited=None):
    """history rows, whatever the nesting: a list of rows, {"rows"/"history"/...: [...]},
    or rides that each hold their own hourly list"""
    inherited = inherited or {}
    if isinstance(data, list):
        for item in data:
            yield from flat_rows(item, inherited)
    elif isinstance(data, dict):
        own = {**inherited, **{k: v for k, v in data.items() if not isinstance(v, (list, dict))}}
        if "id" in own and "rideId" not in own and "rideName" not in own and "name" in own:
            own["rideName"] = own["name"]
        if "avgWait" in data:
            row = dict(own)
            row.setdefault("rideName", own.get("name"))
            yield row
            return
        for v in data.values():
            if isinstance(v, (list, dict)):
                yield from flat_rows(v, own)


def history(park_id, start, end):
    """hourly rows [date, hour, rideName, avgWait, waitReadings] for start <= date < end"""
    rows = []
    while start < end:
        stop = min(start + timedelta(days=WINDOW), end)
        params = {"from": start.isoformat(), "to": stop.isoformat(), "granularity": "hour"}
        cursor = None
        while True:
            page = get(f"/parks/{park_id}/history", {**params, **({"cursor": cursor} if cursor else {})})
            for r in flat_rows(page.get("data")):
                if r.get("avgWait") is None or not r.get("waitReadings"):
                    continue  # closed or no numeric wait: not a zero
                rows.append([r["date"], r["hour"], r.get("rideName"), r["avgWait"], r["waitReadings"]])
            if "history" not in SHOWN:
                SHOWN.add("history")
                print(f"  history reply layout: {json.dumps(shape(page))}")
            cursor = (page.get("meta") or {}).get("nextCursor")
            if not cursor:
                break
        start = stop
    return rows


def main():
    if not os.environ.get("PQT_KEY"):
        print("PQT_KEY not set: skipping Park Queue Times history")
        return
    CACHE.mkdir(exist_ok=True)
    stamp = CACHE / "fetched.txt"
    today = datetime.now(timezone.utc).date()
    if stamp.exists() and stamp.read_text().strip() == today.isoformat():
        print("Park Queue Times history already fetched today: using the cache")
        return
    print("Park Queue Times: finding parks")
    try:
        ids = find_pqt_parks()
    except Exception as ex:
        print(f"  couldn't list parks ({ex}): keeping the old cache")
        return
    start, end = today - timedelta(days=DAYS - 1), today + timedelta(days=1)
    ok = True
    for (resort, name), pid in ids.items():
        try:
            rows = history(pid, start, end)
        except Exception as ex:
            print(f"  {name}: {ex} (keeping the old cache for this park)")
            ok = False
            continue
        target = CACHE / f"{resort}--{name}.json".replace("/", "-")
        target.write_text(json.dumps({"resort": resort, "park": name, "pqtId": pid,
                                      "from": start.isoformat(), "rows": rows}, separators=(",", ":")))
        days = len({r[0] for r in rows})
        print(f"  {resort} / {name}: {len(rows)} ride-hours over {days} days")
    if ok:
        stamp.write_text(today.isoformat())


if __name__ == "__main__":
    main()
