#!/usr/bin/env python3
"""
Adds service type and food-mood tags to data/restaurants.json and writes
data/restaurant-tags.json (keyed by restaurant ID) and a readable CSV.

Re-run any time the restaurant list is refreshed: new restaurants that
aren't in TAGS below get "needs_check": true so they're easy to spot.

Service: Q quick service, T table service, S snack/cart, B bar/lounge,
         X seasonal or special-ticket (e.g. Halloween Horror Nights booths)
A trailing "?" on a line means "best guess, please verify".
"""
import csv
import json
import re
from pathlib import Path

SERVICE = {"Q": "quick", "T": "table", "S": "snack", "B": "bar", "X": "seasonal"}
MOODS = {"burgers", "mexican", "pizza", "asian", "bbq", "seafood", "sandwiches",
         "comfort", "international", "snack", "sweet", "coffee", "drinks", "breakfast"}

# name | service | moods (comma separated) [| ?]
TAGS = """
# ---------- Disneyland Paris: Disney Adventure World ----------
Bistrot Chez Rémy|T|international
Café Luminosity|Q|sandwiches,sweet|?
Chez Berlioz|Q|international|?
Chez Marie|Q|international|?
Chez Toulouse|S|sweet|?
FAN-tastic Food Truck|S|snack
Ice Cream Creations|S|sweet
La Terrasse Panoramique|Q|international|?
Laugh’N' Go!|S|snack|?
Nordic Crowns Tavern|Q|international|?
PYM Kitchen|T|international
Searchlight|S|snack|?
Speciality Ice Cream|S|sweet
Stark Factory|Q|pizza
Super Diner|Q|burgers|?
The Hollywood Gardens Restaurant|T|international|?
The Regal View Lounge|B|drinks
The Regal View Restaurant|T|international
WEB Food Truck|S|snack,sandwiches
# ---------- Disneyland Paris: Disneyland Park ----------
Agrabah Café Restaurant|T|international
Au Chalet de la Marionnette|Q|burgers
Auberge de Cendrillon|T|international
Cable Car Bake Shop|Q|sandwiches,sweet
Café Hyperion|Q|burgers
Café de la Brousse|S|snack
Captain Jack's - Restaurant des Pirates|T|seafood
Casa de Coco – Restaurante de Familia|T|mexican
Casey’s Corner|Q|snack
Character Dining at Plaza Gardens Restaurant|T|international
Colonel Hathi’s Outpost Restaurant|Q|international|?
Cookie Kitchen|S|sweet
Cool Post|S|snack,sweet
Cool Station|S|snack
Cowboy Cookout Barbecue|Q|bbq
Critter Corral|S|snack
L'Arbre Enchanté|Q|sandwiches|?
Last Chance Cafe|Q|mexican
March Hare Refreshments|S|sweet
Market House Deli|Q|sandwiches
Overland Trail Cafe|S|snack|?
Pizzeria Bella Notte|Q|pizza
Plaza Gardens Restaurant|T|international
Restaurant Hakuna Matata|Q|international
Rocket Café|S|snack|?
Silver Spur Steakhouse|T|comfort
The Gibson Girl Ice Cream Parlour|S|sweet
The Ice Cream Company|S|sweet
The Lucky Nugget Saloon|Q|comfort|?
The Old Mill|S|snack|?
Toad Hall Restaurant|Q|seafood
Victoria’s Home-Style Restaurant|Q|sandwiches
Walt’s – an American restaurant|T|comfort
# ---------- Disney California Adventure ----------
Adorable Snowman Frosted Treats|S|sweet
Aunt Cass Café|Q|sandwiches,coffee
Award Wieners|Q|snack
Bayside Brews|B|drinks
Boardwalk Pizza & Pasta|Q|pizza
Boardwalk Pizza & Pasta's Seasonal Novelty Release|X|snack
Cappuccino Cart|S|coffee
Carthay Circle Lounge|B|drinks
Carthay Circle Restaurant|T|comfort
Clarabelle's Hand-Scooped Ice Cream|S|sweet
Cocina Cucamonga Mexican Grill|Q|mexican
Corn Dog Castle|S|snack
Cozy Cone Motel 1 - Churros|S|sweet
Cozy Cone Motel 2 - Ice Cream Cones|S|sweet
Cozy Cone Motel 3 - Chili Cone Queso|S|snack
Cozy Cone Motel 4 - Frozen Cone-coctions|S|sweet
Cozy Cone Motel 5 - Popcone|S|snack
Flo's V8 Cafe|Q|comfort
Hollywood Lounge|B|drinks
Hollywood Lounge's Seasonal Novelty Release|X|drinks
Lamplight Lounge|T|burgers,comfort
Lamplight Lounge - Boardwalk Dining|Q|burgers
Lucky Fortune Cookery|Q|asian
Magic Key Terrace - Magic Key Holder Dining|X|international
Mendocino Terrace|B|drinks
Paradise Garden Grill|Q|international|?
Popcorn at Grizzly Peak Airfield|S|snack
Port of San Fransokyo Cervecería|B|drinks
Pym Tasting Lab|B|drinks
Pym Test Kitchen|Q|sandwiches,burgers
Rita's Turbine Blenders|S|sweet,drinks
Schmoozies!|S|sweet
Smokejumpers Grill|Q|burgers
Sonoma Terrace|B|drinks
Studio Catering Co.|Q|sandwiches
Wine Country Trattoria|T|pizza
# ---------- Disneyland Park (California) ----------
Alien Pizza Planet Express|Q|pizza
Bengal Barbecue|Q|bbq
Blue Bayou Restaurant|T|comfort
Cafe Orleans|T|sandwiches,comfort
Café Daisy|Q|pizza,sandwiches
Carnation Café|T|comfort,breakfast
Docking Bay 7 Food and Cargo|Q|international
Edelweiss Snacks|S|snack
Galactic Grill|Q|burgers
Galactic Grill’s Seasonal Novelty Release|X|snack
Gibson Girl Ice Cream Parlor|S|sweet
Harbour Galley|Q|seafood
Hungry Bear Barbecue Jamboree|Q|bbq
Jolly Holiday Bakery Cafe|Q|sandwiches,sweet
Little Red Wagon|S|snack
Milk Stand|S|sweet
Mint Julep Bar|S|sweet
Oga's Cantina at the Disneyland Resort|B|drinks
Plaza Inn|Q|comfort
Red Rose Taverne|Q|burgers
Refreshment Corner|Q|snack
River Belle Terrace|T|comfort|?
Ronto Roasters|Q|sandwiches
Royal Street Veranda|S|comfort
Stage Door Café|Q|burgers
The Tropical Hideaway Express|S|sweet
Tiana’s Palace|Q|comfort
Tiki Juice Bar|S|sweet
Troubadour Tavern|S|snack
Troubadour Tavern's Seasonal Novelty Release|X|snack
# ---------- Disneyland Resort: outside parks ----------
BOPO GO!|Q|sandwiches|?
Ballast Point® Brewing Co.|T|burgers,drinks
Broken Spell Lounge|B|drinks
Character Dining|T|international|?
Céntrico|T|mexican|?
Din Tai Fung|T|asian
GCH Craftsman Bar|B|drinks
Goofy's Kitchen|T|comfort
Great Maple Modern American Eatery|T|comfort
Hearthstone Lounge|B|drinks
Jazz Kitchen Coastal Grill & Patio|T|comfort,seafood
Napa Rose|T|international
Naples Ristorante e Bar|T|pizza
Palm Breeze Bar|B|drinks
Paseo|T|mexican
Splitsville Luxury Lanes™ – Dining|T|burgers,asian
Storytellers Cafe|T|comfort
Tangaroa Terrace Tropical Bar & Grill|Q|burgers
The Coffee House|S|coffee
Trader Sam's Enchanted Tiki Bar|B|drinks
Vista Parkside Market|Q|sandwiches|?
# ---------- Universal Epic Universe ----------
Atlantic|T|seafood
Bar Moonshine™|B|drinks
Bar Zenith|B|drinks
Bieraubeurre Cart|S|sweet,drinks
Café L’air De La Sirène™|Q|seafood,international
CelesTiki|B|drinks
Celestial Popcorn|S|snack
Comet Dogs|Q|snack
Das Stakehaus|Q|sandwiches|?
De Lacey's Cottage|S|international|?
Frosty Moon|S|sweet
Goddess of Refreshment|S|drinks
Hooligan's Grog & Gruel|Q|comfort|?
Le Gobelet Noir™|Q|international
Mead Hall|S|drinks
Meteor Astropub|Q|burgers
Pizza Moon|Q|pizza
Pizza Moon Pickup|Q|pizza
Satellite Shakes|S|sweet
Spit Fyre Grill|Q|bbq
Star Sui Bao|Q|asian
Starbucks|S|coffee
Starbucks® Coffee|S|coffee
The Blue Dragon Pan-Asian Restaurant|Q|asian
The Bubbly Barrel|S|sweet,drinks
The Burning Blade Tavern|Q|comfort,drinks|?
The Burning Blade Tavern Pick Up|Q|comfort|?
The Oak & Star Tavern|Q|bbq|?
The Plastered Owl|B|drinks
Toadstool Cafe™|Q|burgers,pizza
Turbo-Boost Treats|S|sweet
Yoshi's Snack Island™|S|snack
# ---------- Islands of Adventure ----------
Ale to the Chief|B|drinks
Auntie Anne's|S|snack
Backwater Bar|B|drinks
Blondie's: Home of the Dagwood|Q|sandwiches
Bone Chillin' Beverages|S|drinks
Cafe 4™|Q|pizza
Captain America Diner®|Q|burgers
Cathy's Ice Cream|S|sweet
Chillin' Charlie's Lemon Slush|S|sweet
Cinnabon®|S|sweet
Circus McGurkus Cafe Stoo-pendous™|Q|pizza,burgers
Circus McGurkus Cafe Stoo-pendous™ Pickup|Q|pizza,burgers
Comic Strip Cafe|Q|asian,mexican
Confisco Grille™|T|comfort
Croissant Moon Bakery™|Q|sandwiches,coffee
Fire Eater's Grill™|Q|international
Green Eggs and Ham™ Cafe|Q|burgers
Hog's Head™|B|drinks
Hop on Pop™ Ice Cream Shop|S|sweet
Marvel Character Dinner|X|comfort
Moose Juice, Goose Juice|S|drinks
Mythos Restaurant™|T|international
Pizza Predattoria™|Q|pizza
Super Hero Cotton Candy|S|sweet
The Burger Digs™|Q|burgers
The Watering Hole™|B|drinks
Three Broomsticks™|Q|comfort
Thunder Falls Terrace™|Q|bbq
Wimpy's|Q|burgers
# ---------- Universal Studios Florida ----------
Avenue Eats|Q|sandwiches|?
Beer Trailer|B|drinks
Bumblebee Man's Taco Truck|Q|mexican
Cafe La Bamba™|Q|comfort|?
Central Park Crêpes|S|sweet
Chez Alcatraz™|B|drinks,seafood
Cletus' Chicken Shack|Q|burgers
Club Horror Bar|X|drinks
Coca-Cola Refresh Lounge|S|drinks
Crosshairs Coop Food Booth|X|snack
Death Tank Food Booth|X|snack
Devilish Delights Food Booth|X|sweet
Dia de los Muertos Bar|X|drinks
Dia de los Muertos Food Booth|X|mexican
DreamWorks Imagination Café|T|international|?
Duff Brewery|B|drinks
Evil Dead Burn Food Booth|X|snack
Fast Food Boulevard|Q|burgers
Finnegan's Bar and Grill™|T|comfort
Flaming Moe's|B|drinks
Florean Fortescue’s Ice-Cream Parlour|S|sweet
Freeze Ray Pops|S|sweet
HHN Bar|X|drinks
Hellraiser Food Booth|X|snack
Häagen-Dazs®|S|sweet
Illumination’s Minion Cafe|Q|burgers,comfort
Illumination’s Minion Cafe Pickup|Q|burgers,comfort
Jack's Surplus Food Booth|X|snack
Keyholder Bar|X|drinks
Krusty Burger|Q|burgers
Lagoon Lemonade|S|drinks
Lard Lad Donuts|S|sweet
Leaky Cauldron™|Q|comfort
Lisa's Teahouse of Horror|Q|sandwiches
Lombard's Seafood Grille™|T|seafood
Louie's Italian Restaurant™|Q|pizza
Luigi's Pizza|Q|pizza
MIB Icee|S|drinks
Maloney's|X|drinks|?
Meetz Meats Food Booth|X|snack
Mel's Drive-In™|Q|burgers
Moe's Tavern|B|drinks
Music Plaza Fanta Bar|S|drinks
Nightmare Fuel Bar|X|drinks
Oddfellow's Menagerie|X|snack|?
Ozzy Osbourne: Prince of Darkness Booth|X|snack
Parkside Fare|Q|sandwiches|?
Pop-A-Nana Popcorn and Drink Cart|S|snack
Production Central Food|Q|burgers|?
Richter's Burger Co.™|Q|burgers
San Francisco Fanta Bar|S|drinks
San Francisco Pastry Company™|S|sweet,coffee
Schwab's Pharmacy|S|sweet
Sinners Food Booth|X|snack
Stranger Things Food Booth|X|snack
Swamp Snacks|S|snack
TODAY Cafe|Q|sandwiches,coffee
The Fountain of Fair Fortune|B|drinks
The Frying Dutchman|Q|seafood
The Hopping Pot|B|drinks,snack
Trolls Treats|S|sweet
World Expo Fanta Bar|S|drinks
# ---------- Volcano Bay ----------
Bambu|Q|burgers
Dancing Dragons Boat Bar|B|drinks
Kohola Reef Restaurant & Social Club™|Q|international
Kunuku Boat Bar|B|drinks
The Feasting Frog™|Q|mexican
Volcano Bay Premium Seating|X|snack
Whakawaiwai Eats|Q|pizza
# ---------- Universal Studios Hollywood ----------
Art the Clown's Tinsel Bar|X|drinks
City Snack Shop|S|snack
Clown Café|X|snack
Cocina Mexicana|Q|mexican
Despicable Delights|S|sweet
Drift & Dine at Hollywood & Dine|Q|international|?
Duff Brewery Beer Garden|B|drinks
Día de los Muertos at Universal Plaza|X|mexican
French Street Bistro|Q|sandwiches
Isla Nu-Bar|B|drinks
Jurassic Cafe|Q|international
Killer Snacks|X|snack
Mel’s Diner|Q|burgers
Minion Cafe|Q|burgers,comfort
Mulligan's Irish Pub|X|drinks|?
Mummy Eats|S|snack
Ozzy's Bar|X|drinks
Palace Deli & Market|Q|sandwiches
Panda Express|Q|asian
Phineas Q. Butterfat's Ice Cream|S|sweet
Power Up Cafe|S|snack
SUPER NINTENDO WORLD™ Popcorn and Drink Cart|S|snack
Studio Cafe|Q|international|?
Studio Scoop|S|sweet
Suds McDuff's Hot Dogs|Q|snack
Universal Tower Snack Bar|S|snack
# ---------- Animal Kingdom ----------
Dawa Bar|B|drinks
Flame Tree Barbecue|Q|bbq
Harambe Market|Q|international
Nomad Lounge|B|drinks
Nomad Lounge To Go|S|drinks
Pizzafari|Q|pizza
Rainforest Cafe® at Disney's Animal Kingdom|T|burgers,comfort
Satu'li Canteen|Q|international
The Smiling Crocodile|S|snack
Thirsty River Bar|B|drinks
Tiffins Restaurant|T|international
Tusker House Restaurant|T|international
Warung Outpost|S|drinks,snack
Yak & Yeti™ Quality Beverages|S|drinks
Yak & Yeti™ Restaurant|T|asian
Zuri's Sweet Shop|S|sweet
# ---------- Blizzard Beach / Typhoon Lagoon ----------
Avalunch|S|snack
Frostbite Freddy's Frozen Refreshments|B|drinks
Lottawatta Lodge|Q|burgers,pizza
Polar Pub|B|drinks
Warming Hut|Q|sandwiches
Leaning Palms|Q|burgers,pizza
Let's Go Slurpin'|B|drinks
Lowtide Lou's|S|snack,drinks
Typhoon Tilly's|Q|seafood,burgers
# ---------- Hollywood Studios ----------
50's Prime Time Café|T|comfort
ABC Commissary|Q|burgers|?
Backlot Express|Q|burgers
BaseLine Tap House|B|drinks
Catalina Eddie's|Q|pizza
Dockside Diner|Q|snack|?
Fairfax Fare|Q|bbq|?
Hollywood & Vine|T|comfort
Kat Saka's Kettle|S|snack
Oga's Cantina|B|drinks
Rosie's All-American Café|Q|burgers
Roundup Rodeo BBQ|T|bbq
Sci-Fi Dine-In Theater Restaurant|T|burgers
The Hollywood Brown Derby|T|international
The Hollywood Brown Derby Lounge|B|drinks
Tune-In Lounge|B|drinks
Woody's Lunch Box|Q|sandwiches,breakfast
# ---------- EPCOT ----------
Akershus Royal Banquet Hall|T|international
Biergarten Restaurant|T|international
Block & Hans|B|drinks
Chefs de France|T|international
Choza de Margarita|B|drinks,mexican
Connections Eatery|Q|burgers,pizza
Coral Reef Restaurant|T|seafood
Crêpes À Emporter by La Crêperie de Paris|S|sweet
Fife & Drum Tavern|S|snack
Funnel Cake|S|sweet
GEO-82|B|drinks
GRAB-N-GOOF|S|snack|?
Garden Grill Restaurant|T|comfort
Karamell-Küche|S|sweet
La Cava del Tequila|B|drinks
La Crêperie de Paris|T|international
La Hacienda de San Angel|T|mexican
La Poutinerie|Q|snack,comfort
Le Cellier Steakhouse|T|comfort
Les Vins des Chefs de France|B|drinks
Monsieur Paul|T|international
Nine Dragons Restaurant|T|asian
Pizza al Taglio|Q|pizza
Refreshment Outpost|S|snack
Regal Eagle Smokehouse: Craft Drafts & Barbecue|Q|bbq
Rose & Crown Dining Room|T|comfort
Rose & Crown Pub|B|drinks
San Angel Inn Restaurante|T|mexican
Shiki-Sai Fireworks Dining Package|X|asian
Shiki-Sai: Sushi Izakaya|T|asian
Sommerfest|Q|sandwiches,snack
Space 220 Lounge|B|drinks
Space 220 Restaurant|T|international
Spice Road Table|T|international
Spice Road Table Bar|B|drinks
Swirled Showcase|S|sweet
Takumi-Tei|T|asian
Tangierine Café: Flavors of the Medina|Q|international
Teppan Edo|T|asian
Tutto Gusto Wine Cellar|B|drinks,pizza
Tutto Italia Ristorante|T|pizza
UK Beer Cart|B|drinks
Via Napoli Ristorante e Pizzeria|T|pizza
Yorkshire County Fish Shop|Q|seafood
# ---------- Magic Kingdom ----------
Astrofizz|S|sweet,drinks
Be Our Guest Restaurant|T|international
Casey's Corner|Q|snack
Cinderella's Royal Table|T|comfort
Columbia Harbour House|Q|seafood
Cosmic Ray's Starlight Café|Q|burgers
Energy Bytes|S|snack|?
Golden Oak Outpost|Q|burgers|?
Jungle Navigation Co. LTD Skipper Canteen|T|international
Liberty Tree Tavern|T|comfort
Main Street Confectionery|S|sweet
Pecos Bill Tall Tale Inn and Cafe|Q|mexican
Pinocchio Village Haus|Q|pizza
Sleepy Hollow|S|sweet
Sunshine Tree Terrace|S|sweet
The Beak and Barrel|B|drinks
The Crystal Palace|T|comfort
The Diamond Horseshoe|T|comfort
The Friar's Nook|Q|snack
The Lunching Pad|Q|snack
The Plaza Restaurant|T|comfort
Tony's Town Square Restaurant|T|pizza
Tortuga Tavern|Q|snack|?
# ---------- Walt Disney World: outside parks ----------
'Ohana|T|international
1900 Park Fare|T|comfort
Ale & Compass Restaurant|T|comfort
Ale & Compass Restaurant To Go|Q|comfort
Amare|T|international
Amorette's Patisserie|S|sweet
B.B. Wolf's Sausage Co.|Q|snack
Beach Club Marketplace|Q|sandwiches
Beaches & Cream Soda Shop|T|burgers,sweet
Beaches Pool Bar & Grill|Q|burgers
Blue Ribbon Corn Dogs|S|snack
BoardWalk Deli|Q|sandwiches
Boatwright's Dining Hall|T|comfort
Boma - Flavors of Africa|T|international
Bourbon Steak - A Michael Mina Restaurant|T|comfort
California Grill|T|international
Capa|T|international
Cape May Cafe|T|seafood
Capt. Cook's|Q|international
Centertown Market|Q|burgers,pizza
Chef Art Smith's Homecomin'|T|comfort
Chef Mickey's|T|comfort
Chill|S|sweet
Chip 'n' Dale's Café at Disney's Lake Buena Vista Golf Course|Q|sandwiches
Chip 'n' Dale’s Deli at Disney's Palm, Magnolia, and Oak Trail Golf Courses|Q|sandwiches
City Works Eatery & Pour House|T|burgers,drinks
Contempo Café|Q|sandwiches,burgers
Crockett's Tavern|Q|comfort
Cítricos|T|international
D-Luxe Burger|Q|burgers
Enchanted Rose|B|drinks
End Zone Food Court|Q|burgers,pizza
Enzo's Hideaway|T|pizza
Everything POP Shopping & Dining|Q|burgers,pizza
Flying Fish|T|seafood
Frontera Cocina|T|mexican
Garden Grove|T|comfort
Gasparilla Island Grill|Q|burgers
Geyser Point Bar & Grill To Go|Q|burgers
Good's Food to Go|Q|burgers
Goofy's Candy Company|S|sweet
Grand Floridian Cafe|T|comfort
Gurgling Suitcase|B|drinks
Hoop-Dee-Doo Musical Revue|T|comfort,bbq
House of Blues® Restaurant & Bar|T|comfort
Hurly-Burly|Q|snack|?
Hurricane Hanna's Waterside Bar and Grill|Q|burgers
Il Mulino|T|pizza
Intermission Food Court|Q|burgers,pizza
Jaleo® by José Andrés|T|international
AbracadaBar|B|drinks
Jiko - The Cooking Place|T|international
Jock Lindsey's Hangar Bar|B|drinks
Kidani Village Breakfast at Sanaa|T|breakfast,international
Kona Cafe|T|asian
Kona Café To Go|Q|coffee,sweet
Landscape of Flavors|Q|international
Leaping Horse Libations|B|drinks
MacGUFFINS|B|drinks
Maria & Enzo's Ristorante|T|pizza
Martha's Vineyard|B|drinks
Maya Grill|T|mexican
Meadow Snack Bar|Q|burgers,snack
Morimoto Asia™|T|asian
Morimoto Asia™ Street Food|Q|asian
Muddy Rivers|B|drinks
Narcoossee's|T|seafood
Oasis Bar & Grill|Q|burgers
Olivia's Cafe|T|comfort
Olivia's Cafe To Go|Q|comfort
Outer Rim|B|drinks
Paddlefish|T|seafood
Paradiso 37, Taste of the Americas|T|mexican,international
Phins|B|drinks
Pizza Window|Q|pizza
Planet Hollywood®|T|burgers
Primo Piatto|Q|pizza
Raglan Road™ Irish Pub and Restaurant|T|comfort
Rainforest Cafe® at Disney Springs Marketplace|T|burgers,comfort
Ravello|T|international
River Roost|B|drinks
Riverside Mill Food Court|Q|burgers,pizza
Rix Sports Bar & Grill|B|drinks
Roaring Fork|Q|burgers
Rosa Mexicano|T|mexican
STK® Steakhouse|T|comfort
Sanaa|T|international
Sanaa To Go|Q|international
Sassagoula Floatworks and Food Factory|Q|burgers,pizza
Scat Cat's Club - Lounge|B|drinks
Sebastian's Bistro|T|seafood
Siestas Cantina|B|drinks,mexican
Splitsville Dining Room|T|burgers,asian
Spyglass Grill|Q|burgers
Stargazers Bar|B|drinks
Steakhouse 71|T|comfort
Steakhouse 71 To Go|Q|comfort
Stir|B|drinks
Story Book Dining at Artist Point with Snow White|T|comfort
Summer House on the Lake|T|international|?
T-REX ™|T|burgers
Tambu Lounge|B|drinks
Terralina Crafted Italian|T|pizza
Territory Lounge|B|drinks
The Artist's Palette|Q|sandwiches,pizza
The BOATHOUSE®: Great Food, Waterfront Dining, Dream Boats™|T|seafood
The Basket at Wine Bar George|Q|sandwiches
The Cake Bake Shop® Restaurant by Gwendolyn Rogers|T|sweet
The Daily Poutine|S|snack
The Dining Room at Victoria & Albert’s|T|international
The Edison|T|comfort
The Front Porch at House of Blues|B|drinks
The Mara|Q|burgers
The Market at Ale & Compass|Q|sandwiches,coffee
The Paddock Grill|Q|burgers
The Perch at Disney's Grand Floridian Resort & Spa|S|coffee,sweet
The Sand Bar|B|drinks
The Smokehouse at House of Blues®|Q|bbq
The Turf Club Bar and Grill|T|comfort
Three Bridges Bar & Grill To Go|Q|international
Three Bridges Bar and Grill at Villa del Lago|T|international
Todd English's bluezoo|T|seafood
Toledo - Tapas, Steak & Seafood|T|international
Topolino's Terrace – Flavors of the Riviera|T|international
Trader Sam's Grog Grotto|B|drinks
Trader Sam's Tiki Terrace|B|drinks
Trail's End Restaurant|T|comfort
Trattoria al Forno|T|pizza
Trattoria al Forno To Go|Q|pizza
Turtle Shack Poolside Snacks|S|snack
Wailulu Bar & Grill|Q|burgers
Wailulu Bar & Grill Breakfast|Q|breakfast
Wailulu Bar & Grill To Go|Q|burgers
Whispering Canyon Cafe|T|bbq,comfort
Wine Bar George – A Restaurant & Bar|T|international
World Premiere Food Court|Q|burgers,pizza
Yachtsman Steakhouse|T|comfort
YeSake Kiosk|S|asian,drinks
eet by Maneet Chauhan|Q|international
"""

BAR_WORDS = re.compile(r"\b(lounge|pool bar|bar|margaritas|spirits|libations|grogs|pub)\b", re.I)


def norm(text):
    return " ".join((text or "").replace("\xa0", " ").split())


def parse_tags():
    table = {}
    for line in TAGS.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        name, svc, moods = norm(parts[0]), parts[1], parts[2]
        unsure = len(parts) > 3 and parts[3] == "?"
        moods = [m for m in moods.split(",") if m]
        assert svc in SERVICE, line
        assert all(m in MOODS for m in moods), line
        table[name] = (SERVICE[svc], moods, unsure)
    return table


def main():
    rows = json.loads(Path("data/restaurants.json").read_text(encoding="utf-8"))
    table = parse_tags()
    out, untagged = {}, []
    for r in rows:
        name = r["name"] or ""
        if norm(name) in table:
            svc, moods, unsure = table[norm(name)]
        elif BAR_WORDS.search(name):
            svc, moods, unsure = "bar", ["drinks"], False
        else:
            svc, moods, unsure = "unknown", [], True
            untagged.append(f'{r["park"]}: {name}')
        out[r["id"]] = {"name": name, "resort": r["resort"], "park": r["park"],
                        "service": svc, "moods": moods, "needs_check": unsure}

    Path("data/restaurant-tags.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    with open("data/restaurant-tags.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["resort", "park", "name", "service", "moods", "needs_check", "id"])
        for rid, t in sorted(out.items(), key=lambda kv: (kv[1]["resort"], kv[1]["park"], kv[1]["name"])):
            w.writerow([t["resort"], t["park"], t["name"], t["service"],
                        " ".join(t["moods"]), "yes" if t["needs_check"] else "", rid])

    unused = sorted(set(table) - {norm(r["name"]) for r in rows})
    print(f"Tagged {len(out) - len(untagged)} of {len(out)}; "
          f"{sum(t['needs_check'] for t in out.values())} flagged to check")
    if untagged:
        print("No tag yet:", *untagged, sep="\n  ")
    if unused:
        print("Tags with no matching restaurant:", *unused, sep="\n  ")


if __name__ == "__main__":
    main()
