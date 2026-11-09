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

APP_RESORTS = {"Disneyland Resort": "America/Los_Angeles", "Disneyland Paris": "Europe/Paris",
               "Walt Disney World": "America/New_York"}
# Parks in the feed that the app leaves out (few queues, would clutter the park list)
SKIP_PARKS = {"Disney's Blizzard Beach Water Park", "Disney's Typhoon Lagoon Water Park"}

# Areas ("lands"), listed in rough walking order round each park.
# The live feed doesn't say which land a ride is in, so it's kept here.
LANDS_DLR = {
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


# Minimum height in inches (only rides that have one). Check signs at the ride.
HEIGHTS_DLR = {
    "Matterhorn Bobsleds": 42, "Indiana Jones™ Adventure": 46, "Space Mountain": 40,
    "Big Thunder Mountain Railroad": 40, "Star Wars: Rise of the Resistance": 40,
    "Star Tours - The Adventures Continue": 40, "Millennium Falcon: Smugglers Run": 38,
    "Tiana's Bayou Adventure": 40, "Chip 'n' Dale's GADGETcoaster": 35, "Autopia": 32,
    "Incredicoaster": 48, "Guardians of the Galaxy - Mission: BREAKOUT!": 40,
    "Grizzly River Run": 42, "Radiator Springs Racers": 40, "Soarin’ Across America": 40,
    "Soarin' Around the World": 40, "Goofy's Sky School": 42, "Silly Symphony Swings": 40,
    "Jumpin' Jellyfish": 40, "Mater's Junkyard Jamboree": 32,
}

# Rides that are mostly indoors (for rainy day mode).
INDOOR_DLR = {
    "Pirates of the Caribbean", "Haunted Mansion Holiday", "Haunted Mansion", "Indiana Jones™ Adventure",
    "Space Mountain", "Star Tours - The Adventures Continue", "Buzz Lightyear Astro Blasters",
    "Star Wars: Rise of the Resistance", "Millennium Falcon: Smugglers Run",
    "Mickey & Minnie's Runaway Railway", "Roger Rabbit's Car Toon Spin", "Peter Pan's Flight",
    "Mr. Toad's Wild Ride", "Snow White's Enchanted Wish", "Pinocchio's Daring Journey",
    "\"it's a small world\"", "The Many Adventures of Winnie the Pooh", "Walt Disney's Enchanted Tiki Room",
    "Great Moments with Mr. Lincoln", "Main Street Cinema", "Opera House - Walt Disney - A Magical Life",
    "Walt Disney - A Magical Life", "The Disney Gallery", "Sleeping Beauty Castle Walkthrough",
    "Pixar Short Film Spotlight", "Fortune Tellers", "Minnie's House",
    "Monsters, Inc. Mike & Sulley to the Rescue!", "Mickey's PhilharMagic", "Animation Academy",
    "Sorcerer's Workshop", "Turtle Talk with Crush", "Guardians of the Galaxy - Mission: BREAKOUT!",
    "WEB SLINGERS: A Spider-Man Adventure", "The Little Mermaid - Ariel's Undersea Adventure",
    "Soarin’ Across America", "Soarin' Around the World", "Toy Story Midway Mania!", "The Bakery Tour",
}


# Fan favourites: restaurants that several Disney dining guides and review round-ups
# consistently rate highly (researched Nov 2026; refresh every few months).
# Notes are our own short summary of what each place is known for.
FAVOURITES_DLR = {
    # Disneyland Park
    "Tiana’s Palace": "Gumbo, shrimp & grits and beignets",
    "Hungry Bear Barbecue Jamboree": "BBQ sandwiches and banana pudding",
    "Plaza Inn": "Classic fried chicken",
    "Bengal Barbecue": "Grilled meat and veggie skewers",
    "Docking Bay 7 Food and Cargo": "Galaxy's Edge themed dishes",
    "Harbour Galley": "Clam chowder in a bread bowl",
    "Little Red Wagon": "Hand-dipped corn dogs",
    "Jolly Holiday Bakery Cafe": "Toasted cheese & tomato soup, pastries",
    "Edelweiss Snacks": "Cheesy garlic bratwurst on pretzel bread",
    "Mint Julep Bar": "Mickey beignets and mint juleps",
    "Blue Bayou Restaurant": "Monte Cristo, dining inside Pirates",
    "Carnation Café": "Comfort food classics like fried pickles",
    # Disney California Adventure
    "Lucky Fortune Cookery": "Bulgogi burrito and ramen",
    "Cocina Cucamonga Mexican Grill": "Quesabirria and street tacos",
    "Aunt Cass Café": "Bread bowls and curry",
    "Paradise Garden Grill": "Seasonal festival menus",
    "Corn Dog Castle": "Corn dogs and cheese sticks",
    "Pym Test Kitchen": "Playful giant and tiny food",
    "Carthay Circle Restaurant": "The park's finest dining",
    "Lamplight Lounge": "Lobster nachos and brunch",
}


# ---------- Disneyland Paris ----------
LANDS_DLP = {
    "Disneyland Park": {
        "Main Street, U.S.A.": [
            "Disneyland Railroad Main Street Station", "Horse-Drawn Streetcars", "Main Street Vehicles"],
        "Frontierland": [
            "Big Thunder Mountain", "Phantom Manor", "Thunder Mesa Riverboat Landing",
            "Rustler Roundup Shootin' Gallery", "Frontierland Playground", "Disneyland Railroad Frontierland Depot"],
        "Adventureland": [
            "Indiana Jones™ and the Temple of Peril", "Pirates of the Caribbean", "Adventure Isle",
            "La Cabane des Robinson", "Le Passage Enchanté d'Aladdin", "Pirates' Beach", "Pirate Galleon"],
        "Fantasyland": [
            "Peter Pan's Flight", "\"it's a small world\"", "Blanche-Neige et les Sept Nains®", "Les Voyages de Pinocchio",
            "Le Carrousel de Lancelot", "Dumbo the Flying Elephant", "Mad Hatter's Tea Cups",
            "Alice's Curious Labyrinth", "Casey Jr. – le Petit Train du Cirque",
            "Le Pays des Contes de Fées, presented by Vittel", "La Tanière du Dragon",
            "La Galerie de la Belle au Bois Dormant", "Disneyland Railroad Fantasyland Station"],
        "Discoveryland": [
            "Star Wars Hyperspace Mountain", "Star Tours: The Adventures Continue*", "Buzz Lightyear Laser Blast",
            "Orbitron®", "Autopia, presented by Avis", "Les Mystères du Nautilus", "Mickey’s PhilharMagic",
            "Disneyland Railroad Discoveryland Station"],
    },
    "Disney Adventure World": {
        "World Premiere Plaza": [
            "The Twilight Zone Tower of Terror", "Les Tapis Volants - Flying Carpets Over Agrabah®"],
        "Marvel Avengers Campus": ["Avengers Assemble: Flight Force", "Spider-Man W.E.B. Adventure"],
        "Worlds of Pixar": [
            "Ratatouille : L’Aventure Totalement Toquée de Rémy", "Crush's Coaster", "RC Racer",
            "Toy Soldiers Parachute Drop", "Slinky® Dog Zigzag Spin", "Cars ROAD TRIP", "Cars Quatre Roues Rallye"],
        "World of Frozen": ["Frozen Ever After"],
        "Adventure Way": ["Raiponce Tangled Spin"],
    },
}

# Minimum height in cm. Check signs at the ride.
HEIGHTS_DLP = {
    "Star Wars Hyperspace Mountain": 120, "Big Thunder Mountain": 102, "Indiana Jones™ and the Temple of Peril": 140,
    "Star Tours: The Adventures Continue*": 102, "Autopia, presented by Avis": 81, "RC Racer": 120,
    "Crush's Coaster": 107, "The Twilight Zone Tower of Terror": 102, "Toy Soldiers Parachute Drop": 81,
    "Avengers Assemble: Flight Force": 120,
}

INDOOR_DLP = {
    "Phantom Manor", "Pirates of the Caribbean", "Peter Pan's Flight", "\"it's a small world\"",
    "Blanche-Neige et les Sept Nains®", "Les Voyages de Pinocchio", "La Tanière du Dragon", "La Galerie de la Belle au Bois Dormant",
    "Le Passage Enchanté d'Aladdin", "Star Wars Hyperspace Mountain", "Star Tours: The Adventures Continue*",
    "Buzz Lightyear Laser Blast", "Les Mystères du Nautilus", "Mickey’s PhilharMagic",
    "The Twilight Zone Tower of Terror", "Avengers Assemble: Flight Force", "Spider-Man W.E.B. Adventure",
    "Crush's Coaster", "Ratatouille : L’Aventure Totalement Toquée de Rémy", "Frozen Ever After",
}

# Fan favourites (researched Nov 2026 from Disneyland Paris dining guides)
FAVOURITES_DLP = {
    "Casa de Coco – Restaurante de Familia": "Burritos, fajitas and churros",
    "Restaurant Hakuna Matata": "Spiced chicken and rice",
    "Colonel Hathi’s Outpost Restaurant": "Mickey-shaped cheese pizza",
    "Café Hyperion": "Burgers under the Discoveryland dome",
    "Toad Hall Restaurant": "Fish and chips, easy with little ones",
    "Captain Jack's - Restaurant des Pirates": "Dining beside the Pirates boats",
    "Walt’s – an American restaurant": "A calm, classy break on Main Street",
    "Auberge de Cendrillon": "Princess character dining",
    "Silver Spur Steakhouse": "Hearty steaks in Frontierland",
    "Bistrot Chez Rémy": "French bistro food at Ratatouille scale",
    "Stark Factory": "Pizza and pasta in Avengers Campus",
    "Super Diner": "Quick, reliable burgers",
    "FAN-tastic Food Truck": "Fast, budget-friendly bites",
    "The Regal View Restaurant": "Views over Adventure Bay",
}


# ----- Walt Disney World (Orlando), checked Nov 2026 -----
LANDS_WDW = {
    "Magic Kingdom Park": {
        "Main Street, U.S.A.": ["Walt Disney World Railroad - Main Street, U.S.A.", "Main Street Vehicles"],
        "Adventureland": ["Pirates of the Caribbean", "Jungle Cruise", "Jingle Cruise", "Walt Disney's Enchanted Tiki Room",
                          "The Magic Carpets of Aladdin", "Swiss Family Treehouse", "A Pirate's Adventure ~ Treasures of the Seven Seas"],
        "Frontierland": ["Big Thunder Mountain Railroad", "Tiana's Bayou Adventure", "Country Bear Musical Jamboree",
                         "Walt Disney World Railroad - Frontierland", "Frontierland Shootin' Arcade"],
        "Liberty Square": ["Haunted Mansion", "The Hall of Presidents", "Liberty Square Riverboat"],
        "Fantasyland": ["Seven Dwarfs Mine Train", "Peter Pan's Flight", "\"it's a small world\"",
                        "The Many Adventures of Winnie the Pooh", "Under the Sea - Journey of The Little Mermaid",
                        "Mickey's PhilharMagic", "Mad Tea Party", "Dumbo the Flying Elephant", "The Barnstormer",
                        "Prince Charming Regal Carrousel", "Casey Jr. Splash 'N' Soak Station", "Cinderella Castle",
                        "Walt Disney World Railroad - Fantasyland", "Enchanted Tales with Belle", "Pete's Silly Sideshow"],
        "Tomorrowland": ["TRON Lightcycle / Run", "Space Mountain", "Buzz Lightyear’s Space Ranger Spin",
                         "Tomorrowland Transit Authority PeopleMover", "Astro Orbiter", "Tomorrowland Speedway",
                         "Monsters, Inc. Laugh Floor", "Walt Disney's Carousel of Progress"],
    },
    "EPCOT": {
        "World Celebration": ["Spaceship Earth", "Project Tomorrow: Inventing the Wonders of the Future",
                              "Journey Into Imagination With Figment", "ImageWorks - The \"What If\" Labs",
                              "Disney and Pixar Short Film Festival"],
        "World Discovery": ["Guardians of the Galaxy: Cosmic Rewind", "Test Track", "Mission: SPACE", "Advanced Training Lab"],
        "World Nature": ["Soarin' Across America", "Soarin' Around the World", "Living with the Land", "Awesome Planet",
                         "The Seas with Nemo & Friends", "Turtle Talk With Crush", "SeaBase Aquarium",
                         "Bruce's Shark World", "Journey of Water, Inspired by Moana"],
        "World Showcase": ["Frozen Ever After", "Remy's Ratatouille Adventure", "Gran Fiesta Tour Starring The Three Caballeros",
                           "Reflections of China", "Canada Far and Wide in Circle-Vision 360", "Impressions de France",
                           "The American Adventure", "Palais du Cinéma", "House of the Whispering Willows",
                           "American Heritage Gallery", "Bijutsu-kan Gallery", "Gallery of Arts and History",
                           "Mexico Folk Art Gallery", "Stave Church Gallery", "Kidcot Fun Stops", "Beauty and the Beast Sing-Along"],
    },
    "Disney's Hollywood Studios": {
        "Hollywood Boulevard": ["Mickey & Minnie's Runaway Railway"],
        "Sunset Boulevard": ["The Twilight Zone™ Tower of Terror", "Rock ’n’ Roller Coaster Starring The Muppets",
                             "Rock 'n' Roller Coaster Starring The Muppets"],
        "Echo Lake": ["Star Tours – The Adventures Continue", "Vacation Fun - An Original Animated Short with Mickey & Minnie",
                      "Indiana Jones™ Epic Stunt Spectacular!"],
        "Star Wars: Galaxy's Edge": ["Star Wars: Rise of the Resistance", "Millennium Falcon: Smugglers Run"],
        "Toy Story Land": ["Slinky Dog Dash", "Alien Swirling Saucers", "Toy Story Mania!"],
        "Animation Courtyard": ["Walt Disney Presents", "Star Wars Launch Bay", "Olaf Draws!", "Once Upon a Studio Theater", "Off the Page!"],
    },
    "Disney's Animal Kingdom Theme Park": {
        "Oasis": ["The Oasis Exhibits"],
        "Discovery Island": ["Zootopia: Better Zoogether!", "Discovery Island Trails", "Wilderness Explorers", "Tree of Life"],
        "Pandora – The World of Avatar": ["Avatar Flight of Passage", "Na'vi River Journey"],
        "Africa": ["Kilimanjaro Safaris", "Gorilla Falls Exploration Trail", "Wildlife Express Train"],
        "Rafiki's Planet Watch": ["Animal Care at Conservation Station", "Jumping Junction", "Bluey's Wild World at Conservation Station"],
        "Asia": ["Expedition Everest - Legend of the Forbidden Mountain", "Kali River Rapids", "Maharajah Jungle Trek"],
    },
}

HEIGHTS_WDW = {
    "Seven Dwarfs Mine Train": 38, "Space Mountain": 44, "TRON Lightcycle / Run": 48, "Big Thunder Mountain Railroad": 40,
    "Tiana's Bayou Adventure": 40, "The Barnstormer": 35, "Tomorrowland Speedway": 32,
    "Guardians of the Galaxy: Cosmic Rewind": 42, "Test Track": 48, "Mission: SPACE": 40,
    "Soarin' Across America": 40, "Soarin' Around the World": 40,
    "Star Wars: Rise of the Resistance": 40, "Millennium Falcon: Smugglers Run": 38, "Slinky Dog Dash": 38,
    "Alien Swirling Saucers": 32, "The Twilight Zone™ Tower of Terror": 40, "Star Tours – The Adventures Continue": 40,
    "Rock ’n’ Roller Coaster Starring The Muppets": 48, "Rock 'n' Roller Coaster Starring The Muppets": 48,
    "Avatar Flight of Passage": 44, "Expedition Everest - Legend of the Forbidden Mountain": 44, "Kali River Rapids": 38,
}

INDOOR_WDW = {
    "Pirates of the Caribbean", "Walt Disney's Enchanted Tiki Room", "Country Bear Musical Jamboree", "Haunted Mansion",
    "The Hall of Presidents", "Peter Pan's Flight", "\"it's a small world\"", "The Many Adventures of Winnie the Pooh",
    "Under the Sea - Journey of The Little Mermaid", "Mickey's PhilharMagic", "Enchanted Tales with Belle", "Space Mountain",
    "Buzz Lightyear’s Space Ranger Spin", "Monsters, Inc. Laugh Floor", "Walt Disney's Carousel of Progress",
    "Spaceship Earth", "Project Tomorrow: Inventing the Wonders of the Future", "Journey Into Imagination With Figment",
    "ImageWorks - The \"What If\" Labs", "Disney and Pixar Short Film Festival", "Guardians of the Galaxy: Cosmic Rewind",
    "Test Track", "Mission: SPACE", "Soarin' Across America", "Soarin' Around the World", "Living with the Land",
    "Awesome Planet", "The Seas with Nemo & Friends", "Turtle Talk With Crush", "SeaBase Aquarium", "Bruce's Shark World",
    "Frozen Ever After", "Remy's Ratatouille Adventure", "Gran Fiesta Tour Starring The Three Caballeros",
    "Reflections of China", "Canada Far and Wide in Circle-Vision 360", "Impressions de France", "The American Adventure",
    "Palais du Cinéma", "House of the Whispering Willows", "American Heritage Gallery", "Bijutsu-kan Gallery",
    "Gallery of Arts and History", "Mexico Folk Art Gallery", "Stave Church Gallery",
    "Mickey & Minnie's Runaway Railway", "The Twilight Zone™ Tower of Terror", "Rock ’n’ Roller Coaster Starring The Muppets",
    "Rock 'n' Roller Coaster Starring The Muppets", "Star Tours – The Adventures Continue",
    "Vacation Fun - An Original Animated Short with Mickey & Minnie", "Star Wars: Rise of the Resistance",
    "Millennium Falcon: Smugglers Run", "Toy Story Mania!", "Walt Disney Presents", "Star Wars Launch Bay",
    "Avatar Flight of Passage", "Na'vi River Journey", "Zootopia: Better Zoogether!", "Animal Care at Conservation Station",
}

# Fan favourites (from Walt Disney World fan dining guides, Nov 2026)
FAVOURITES_WDW = {
    "Columbia Harbour House": "Fried shrimp and lobster roll, quiet upstairs seating",
    "Pecos Bill Tall Tale Inn and Cafe": "Big burritos and a toppings bar",
    "Casey's Corner": "Hot dogs and corn dog nuggets",
    "Cosmic Ray's Starlight Café": "Burgers and chicken, lots of seats",
    "Sleepy Hollow": "Waffle sandwiches and funnel cakes",
    "Be Our Guest Restaurant": "Dinner inside the Beast's castle",
    "Jungle Navigation Co. LTD Skipper Canteen": "Jungle Cruise jokes with dinner",
    "Liberty Tree Tavern": "Thanksgiving-style family feast",
    "Regal Eagle Smokehouse: Craft Drafts & Barbecue": "BBQ brisket and burnt ends",
    "Yorkshire County Fish Shop": "Proper fish and chips",
    "Space 220 Restaurant": "Dining 220 miles above Earth",
    "Le Cellier Steakhouse": "Steak and cheddar soup in Canada",
    "Via Napoli Ristorante e Pizzeria": "Wood-fired Neapolitan pizza",
    "Takumi-Tei": "Elegant Japanese dining",
    "Karamell-Küche": "Caramel treats in Germany",
    "Docking Bay 7 Food and Cargo": "Galaxy's Edge themed dishes",
    "Ronto Roasters": "The famous Ronto Wrap",
    "Woody's Lunch Box": "Lunch Box Tarts and grilled sandwiches",
    "50's Prime Time Café": "Comfort food, eat your veggies!",
    "Sci-Fi Dine-In Theater Restaurant": "Eat in a car at a drive-in movie",
    "Roundup Rodeo BBQ": "All-you-can-eat Toy Story BBQ",
    "Satu'li Canteen": "Build-your-own bowls in Pandora",
    "Flame Tree Barbecue": "Ribs and pulled pork with river views",
    "Harambe Market": "Ribs and street food in Africa",
    "Tiffins Restaurant": "The park's best sit-down meal",
    "Yak & Yeti™ Restaurant": "Pan-Asian plates near Everest",
}

LANDS = {"Disneyland Resort": LANDS_DLR, "Disneyland Paris": LANDS_DLP, "Walt Disney World": LANDS_WDW}
HEIGHT_UNIT = {"Disneyland Resort": "in", "Disneyland Paris": "cm", "Walt Disney World": "in"}
HEIGHTS = {"Disneyland Resort": HEIGHTS_DLR, "Disneyland Paris": HEIGHTS_DLP, "Walt Disney World": HEIGHTS_WDW}
INDOOR = {"Disneyland Resort": INDOOR_DLR, "Disneyland Paris": INDOOR_DLP, "Walt Disney World": INDOOR_WDW}
FAVOURITES = {"Disneyland Resort": FAVOURITES_DLR, "Disneyland Paris": FAVOURITES_DLP, "Walt Disney World": FAVOURITES_WDW}


def norm(text):
    return " ".join((text or "").split())


def land_lookup(resort, park_name):
    """ride name -> (land, order of that land in the park)"""
    out = {}
    for i, (land, rides) in enumerate(LANDS.get(resort, {}).get(park_name, {}).items()):
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


def opening_hours(entity_id, days=7):
    """{"YYYY-MM-DD": [["08:00", "21:00"], ...]} for the next few days, park-local times"""
    try:
        sched = fetch(f"/entity/{entity_id}/schedule").get("schedule", [])
    except Exception as ex:
        print(f"  no schedule for {entity_id}: {ex}")
        return {}
    out = {}
    for s in sched:
        if s.get("type") != "OPERATING":
            continue
        start, end, date = s.get("openingTime") or "", s.get("closingTime") or "", s.get("date") or ""
        if len(start) < 16 or len(end) < 16 or not date:
            continue
        out.setdefault(date, []).append([start[11:16], end[11:16]])
    keep = sorted(out)[:days]
    return {d: out[d] for d in keep}


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
            if label != resort or park_name in SKIP_PARKS:
                continue
            kids = fetch(f"/entity/{park_id}/children").get("children", [])
            lands = land_lookup(resort, park_name)
            heights, indoor = HEIGHTS.get(resort, {}), INDOOR.get(resort, set())
            rides = []
            for k in kids:
                if k.get("entityType") != "ATTRACTION":
                    continue
                land, order = lands.get(" ".join((k.get("name") or "").split()), ("Other", 99))
                if land == "Other":
                    print(f"  no land for: {k.get('name')}")
                clean = " ".join((k.get("name") or "").split())
                rides.append({"id": k["id"], "name": k.get("name"), "land": land, "landOrder": order,
                              "height": heights.get(clean), "indoor": clean in indoor,
                              "heightCm": (round(heights[clean] * 2.54) if HEIGHT_UNIT[resort] == "in" else heights[clean])
                              if clean in heights else None,
                              "loc": location_of(k["id"], cache),
                              "typical": history.get(k["id"])})
            food = []
            for rid, t in tags.items():
                if t["resort"] == resort and t["park"] == park_name \
                        and t["service"] in ("quick", "snack", "table"):
                    food.append({"id": rid, "name": t["name"], "service": t["service"],
                                 "moods": t["moods"], "loc": location_of(rid, cache),
                                 "fav": FAVOURITES.get(resort, {}).get(norm(t["name"])),
                                 "hours": opening_hours(rid)})
            rides.sort(key=lambda r: (r["landOrder"], (r["name"] or "").strip('"').lower()))
            food.sort(key=lambda r: r["name"])
            out["parks"].append({"id": park_id, "name": park_name,
                                 "hours": opening_hours(park_id),
                                 "rides": rides, "food": food})
            with_hours = sum(1 for f in food if f["hours"])
            print(f"{park_name}: {len(rides)} rides, {len(food)} places to eat "
                  f"({with_hours} with opening hours)")

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
