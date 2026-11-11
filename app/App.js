// Ride Next — version 5 (Disneyland Resort, Disneyland Paris and Walt Disney World, with Day Wrapped)
/* eslint-disable react-hooks/exhaustive-deps -- some hooks re-run on purpose only every few minutes, to save battery */
// Live waits: ThemeParks.wiki (free, unofficial). History + restaurants: your GitHub repo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, Vibration, View, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'; // replaces React Native's deprecated SafeAreaView
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Pedometer } from 'expo-sensors';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons'; // built into Expo, so it always matches Expo Go

const DATA_BASE = 'https://raw.githubusercontent.com/megancartwright10-cmd/logger.py/main/data/app/';
const RESORTS = {
  dlr: {
    key: 'dlr', name: 'Disneyland Resort', short: 'Disneyland', city: 'Anaheim', country: 'California, USA',
    parks: 'Disneyland Park · Disney California Adventure', dataUrl: `${DATA_BASE}disneyland-resort.json`,
    diningUrl: 'https://disneyland.disney.go.com/dining/', cur: '$', payName: 'Lightning Lane Single Pass',
    payShort: 'Lightning Lane', hasMulti: true, metric: false, distKm: true, clock24: false, switchName: 'Rider Switch',
    heightOptions: [null, 32, 35, 38, 40, 42, 46, 48], // inches (distances in km)
    hopMin: 12, hopLabel: 'Walk',
  },
  dlp: {
    key: 'dlp', name: 'Disneyland Paris', short: 'Disneyland Paris', city: 'Paris', country: 'France',
    parks: 'Disneyland Park · Disney Adventure World', dataUrl: `${DATA_BASE}disneyland-paris.json`,
    diningUrl: 'https://www.disneylandparis.com/en-gb/dining/advance-table-booking', cur: '€', payName: 'Premier Access One',
    payShort: 'Premier Access', hasMulti: false, metric: true, clock24: true, switchName: 'Baby Switch',
    heightOptions: [null, 81, 95, 102, 107, 120, 132, 140], // cm
    hopMin: 10, hopLabel: 'Walk',
  },
  wdw: {
    key: 'wdw', name: 'Walt Disney World', short: 'Disney World', city: 'Orlando', country: 'Florida, USA',
    parks: 'Magic Kingdom · EPCOT · Hollywood Studios · Animal Kingdom', dataUrl: `${DATA_BASE}walt-disney-world.json`,
    diningUrl: 'https://disneyworld.disney.go.com/dining/', cur: '$', payName: 'Lightning Lane Single Pass',
    payShort: 'Lightning Lane', hasMulti: true, metric: false, clock24: false, switchName: 'Rider Switch',
    heightOptions: [null, 32, 35, 38, 40, 42, 44, 48], // inches
    hopMin: 40, hopLabel: 'Travel', // parks are miles apart: bus, monorail or Skyliner
  },
};
const toCm = (R, h) => (h == null ? null : R.metric ? h : Math.round(h * 2.54));
const heightLabel = (R, r) => (R.metric ? `${r.heightCm} cm` : `${r.height} in`);
const norm = (t) => (t || '').split(/\s+/).join(' ').trim();
const LIVE_URL = (id) => `https://api.themeparks.wiki/v1/entity/${id}/live`;
const SCHEDULE_URL = (id) => `https://api.themeparks.wiki/v1/entity/${id}/schedule`;
const STORE_KEY = 'ridenext:v1';
const REFRESH_MS = 3 * 60 * 1000;
const LL_WAIT = 10; // rough Lightning Lane wait, minutes
const FAST_REFRESH_MS = 60 * 1000; // while a ride you care about is down
const MULTI_PASS_GAP_MIN = 120; // Disney: book again after using it, or 2 hours after booking

// Rides people rush to at opening, in rough priority order (used when there's no history yet)
const HEADLINERS = {
  'dlr:Disneyland Park': ['Star Wars: Rise of the Resistance', 'Space Mountain', 'Indiana Jones™ Adventure',
    "Mickey & Minnie's Runaway Railway", "Tiana's Bayou Adventure", 'Matterhorn Bobsleds', "Peter Pan's Flight",
    'Millennium Falcon: Smugglers Run', 'Big Thunder Mountain Railroad'],
  'dlr:Disney California Adventure Park': ['Radiator Springs Racers', 'WEB SLINGERS: A Spider-Man Adventure',
    'Guardians of the Galaxy - Mission: BREAKOUT!', 'Incredicoaster', 'Toy Story Midway Mania!',
    'Soarin’ Across America', 'Grizzly River Run'],
  'dlp:Disneyland Park': ["Peter Pan's Flight", 'Star Wars Hyperspace Mountain', 'Big Thunder Mountain',
    'Indiana Jones™ and the Temple of Peril', 'Phantom Manor', 'Pirates of the Caribbean', 'Buzz Lightyear Laser Blast',
    'Star Tours: The Adventures Continue*'],
  'dlp:Disney Adventure World': ['Frozen Ever After', 'Ratatouille : L’Aventure Totalement Toquée de Rémy',
    'Spider-Man W.E.B. Adventure', 'Avengers Assemble: Flight Force', "Crush's Coaster",
    'The Twilight Zone Tower of Terror', 'RC Racer'],
  'wdw:Magic Kingdom Park': ['TRON Lightcycle / Run', 'Seven Dwarfs Mine Train', "Peter Pan's Flight", "Tiana's Bayou Adventure",
    'Space Mountain', 'Big Thunder Mountain Railroad', 'Haunted Mansion', 'Jungle Cruise', 'The Many Adventures of Winnie the Pooh'],
  'wdw:EPCOT': ['Guardians of the Galaxy: Cosmic Rewind', 'Test Track', 'Frozen Ever After', "Remy's Ratatouille Adventure",
    "Soarin' Across America", "Soarin' Around the World", 'Mission: SPACE', 'Spaceship Earth'],
  "wdw:Disney's Hollywood Studios": ['Star Wars: Rise of the Resistance', 'Slinky Dog Dash', "Mickey & Minnie's Runaway Railway",
    'Rock ’n’ Roller Coaster Starring The Muppets', 'The Twilight Zone™ Tower of Terror', 'Millennium Falcon: Smugglers Run',
    'Toy Story Mania!', 'Alien Swirling Saucers'],
  "wdw:Disney's Animal Kingdom Theme Park": ['Avatar Flight of Passage', "Na'vi River Journey", 'Kilimanjaro Safaris',
    'Expedition Everest - Legend of the Forbidden Mountain', 'Zootopia: Better Zoogether!', 'Kali River Rapids'],
};

// Most popular things people order. Menus change, so people can add their own too.
const SNACKS = {
  'dlr:Disneyland Park': [
    { id: 'dole-whip', name: 'Dole Whip', where: 'Tiki Juice Bar / The Tropical Hideaway' },
    { id: 'mint-julep', name: 'Mint Julep (non-alcoholic)', where: 'Mint Julep Bar' },
    { id: 'beignets', name: 'Mickey beignets', where: 'Mint Julep Bar' },
    { id: 'churro', name: 'Churro', where: 'Snack carts around the park' },
    { id: 'corn-dog', name: 'Hand-dipped corn dog', where: 'Little Red Wagon' },
    { id: 'monte-cristo', name: 'Monte Cristo', where: 'Cafe Orleans' },
    { id: 'chowder', name: 'Clam chowder bread bowl', where: 'Harbour Galley' },
    { id: 'blue-milk', name: 'Blue or green milk', where: 'Milk Stand' },
    { id: 'ronto', name: 'Ronto Wrap', where: 'Ronto Roasters' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
    { id: 'ice-cream', name: 'Ice cream', where: 'Gibson Girl Ice Cream Parlor' },
  ],
  'dlr:Disney California Adventure Park': [
    { id: 'churro', name: 'Churro', where: 'Carts and Cozy Cone Motel' },
    { id: 'cozy-cone', name: 'Cozy Cone treat', where: 'Cozy Cone Motel' },
    { id: 'corn-dog', name: 'Corn dog', where: 'Corn Dog Castle' },
    { id: 'lobster-nachos', name: 'Lobster nachos', where: 'Lamplight Lounge' },
    { id: 'pym', name: 'Something giant (or tiny)', where: 'Pym Test Kitchen' },
    { id: 'ice-cream', name: 'Ice cream', where: "Clarabelle's" },
    { id: 'smoothie', name: 'Smoothie', where: 'Schmoozies!' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
  'dlp:Disneyland Park': [
    { id: 'beignets', name: 'Mickey beignets', where: 'Snack stands around the park' },
    { id: 'crepe', name: 'Nutella crêpe', where: 'Crêpe stands around the park' },
    { id: 'churro', name: 'Churro', where: 'Snack carts' },
    { id: 'cookies', name: 'Character cookie', where: 'Cable Car Bake Shop' },
    { id: 'candy', name: 'Cake pop or sweets', where: 'Boardwalk Candy Palace' },
    { id: 'ice-cream', name: 'Ice cream sundae', where: 'The Gibson Girl Ice Cream Parlour' },
    { id: 'hot-dog', name: 'Hot dog', where: 'Casey’s Corner' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
  'dlp:Disney Adventure World': [
    { id: 'ice-cream', name: 'Themed ice cream', where: 'Ice Cream Creations' },
    { id: 'crepe', name: 'Nutella crêpe', where: 'Snack stands' },
    { id: 'churro', name: 'Churro', where: 'Snack carts' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
  'wdw:Magic Kingdom Park': [
    { id: 'dole-whip', name: 'Dole Whip', where: 'Aloha Isle' },
    { id: 'churro', name: 'Churro', where: 'Snack carts around the park' },
    { id: 'turkey-leg', name: 'Turkey leg', where: 'Frontierland carts' },
    { id: 'mickey-bar', name: 'Mickey ice cream bar', where: 'Ice cream carts' },
    { id: 'cinnamon-roll', name: 'Cinnamon roll', where: 'Gaston\'s Tavern' },
    { id: 'lefous-brew', name: "LeFou's Brew", where: 'Gaston\'s Tavern' },
    { id: 'waffle', name: 'Waffle sandwich', where: 'Sleepy Hollow' },
    { id: 'corn-dog', name: 'Corn dog nuggets', where: "Casey's Corner" },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
  'wdw:EPCOT': [
    { id: 'school-bread', name: 'School bread', where: 'Kringla Bakeri og Kafe (Norway)' },
    { id: 'croissant', name: 'Croissant or pastry', where: 'Les Halles Boulangerie-Patisserie (France)' },
    { id: 'pretzel', name: 'Pretzel', where: 'Germany pavilion' },
    { id: 'caramel', name: 'Caramel treat', where: 'Karamell-Küche (Germany)' },
    { id: 'gelato', name: 'Gelato', where: 'Italy pavilion' },
    { id: 'churro', name: 'Churro', where: 'Mexico pavilion' },
    { id: 'poutine', name: 'Poutine', where: 'La Poutinerie (Canada)' },
    { id: 'crepe', name: 'Crêpe', where: 'Crêpes À Emporter (France)' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
  "wdw:Disney's Hollywood Studios": [
    { id: 'blue-milk', name: 'Blue or green milk', where: 'Milk Stand' },
    { id: 'ronto', name: 'Ronto Wrap', where: 'Ronto Roasters' },
    { id: 'lunch-box-tart', name: 'Lunch Box Tart', where: "Woody's Lunch Box" },
    { id: 'kettle-corn', name: 'Outpost popcorn mix', where: "Kat Saka's Kettle" },
    { id: 'churro', name: 'Churro', where: 'Snack carts' },
    { id: 'ice-cream', name: 'Ice cream', where: 'Hollywood Scoops' },
  ],
  "wdw:Disney's Animal Kingdom Theme Park": [
    { id: 'pongu', name: 'Night Blossom drink', where: 'Pongu Pongu' },
    { id: 'pod', name: 'Pongu Lumpia', where: 'Pongu Pongu' },
    { id: 'cheeseburger-pod', name: 'Cheeseburger pod', where: "Satu'li Canteen" },
    { id: 'churro', name: 'Churro', where: 'Snack carts' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
};
const STEP_KM = 0.000762; // average stride ~76 cm
const STEP_MILES = 0.000473; // average stride ~2.5 ft

// ---------- notifications ----------
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
} catch (e) { /* not available */ }
const DATE_TRIGGER = (Notifications.SchedulableTriggerInputTypes && Notifications.SchedulableTriggerInputTypes.DATE) || 'date';
async function askNotifyPermission() {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch (e) { return false; }
}
async function notifyNow(title, body) {
  try { await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }); } catch (e) { /* ignore */ }
}
async function notifyAt(date, title, body) {
  try {
    return await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { type: DATE_TRIGGER, date } });
  } catch (e) { return null; }
}
async function cancelNotify(id) {
  try { if (id) await Notifications.cancelScheduledNotificationAsync(id); } catch (e) { /* ignore */ }
}

// ---------- Day Wrapped ----------
// Palettes chosen by Megan. Each one sets the colours for every slide.
const WRAP_PALETTES = [
  { id: 'haunted', name: 'Haunted', sw: ['#241A33', '#A7E8C3', '#8B7BA8', '#E6B85C'],
    open: { bg: '#241A33', fg: '#FFFFFF', a: '#8B7BA8', b: '#A7E8C3', ring: '#E6B85C', kicker: '#E6B85C', sub: '#D9D2E6' },
    rides: { bg: '#8B7BA8', fg: '#FFFFFF', ring: '#241A33', b: '#A7E8C3', card: '#241A33', cardFg: '#FFFFFF', cardKicker: '#A7E8C3', cardSub: '#D9D2E6' },
    queue: { bg: '#A7E8C3', fg: '#241A33', stripe: '#241A33', circle: '#8B7BA8', chipBg: '#241A33', chipIcon: '#E6B85C', chipText: '#FFFFFF' },
    walk: { bg: '#241A33', fg: '#FFFFFF', path: '#A7E8C3', circle: '#8B7BA8', sub: '#D9D2E6' },
    snacks: { bg: '#E6B85C', fg: '#241A33', circleA: '#8B7BA8', circleB: '#A7E8C3', rowBg: '#FFFFFF', rowFg: '#241A33', count: '#6B5A8E' },
    persona: { bg: '#241A33', fg: '#FFFFFF', star: '#A7E8C3', disc: '#E6B85C', discIcon: '#241A33', kicker: '#A7E8C3', sub: '#D9D2E6' },
    summary: { bg: '#A7E8C3', fg: '#241A33', kicker: '#241A33', panel: '#FFFFFF', mute: '#4B3F5E', foot: '#241A33', footFg: '#FFFFFF', footSub: '#A7E8C3', footIcon: '#E6B85C',
      tiles: [['#241A33', '#FFFFFF'], ['#E6B85C', '#241A33'], ['#8B7BA8', '#241A33'], ['#FFFFFF', '#241A33']] } },
  { id: 'lakeside', name: 'Lakeside', sw: ['#BFD0D8', '#85A4BD', '#202923', '#555C52'],
    open: { bg: '#202923', fg: '#FFFFFF', a: '#85A4BD', b: '#555C52', ring: '#BFD0D8', kicker: '#BFD0D8', sub: '#BFD0D8' },
    rides: { bg: '#85A4BD', fg: '#202923', ring: '#BFD0D8', b: '#202923', card: '#202923', cardFg: '#FFFFFF', cardKicker: '#85A4BD', cardSub: '#BFD0D8' },
    queue: { bg: '#BFD0D8', fg: '#202923', stripe: '#202923', circle: '#85A4BD', chipBg: '#202923', chipIcon: '#85A4BD', chipText: '#FFFFFF' },
    walk: { bg: '#555C52', fg: '#FFFFFF', path: '#BFD0D8', circle: '#85A4BD', sub: '#DCE6EB' },
    snacks: { bg: '#BFD0D8', fg: '#202923', circleA: '#85A4BD', circleB: '#555C52', rowBg: '#FFFFFF', rowFg: '#202923', count: '#555C52' },
    persona: { bg: '#202923', fg: '#FFFFFF', star: '#85A4BD', disc: '#BFD0D8', discIcon: '#202923', kicker: '#BFD0D8', sub: '#BFD0D8' },
    summary: { bg: '#BFD0D8', fg: '#202923', kicker: '#202923', panel: '#FFFFFF', mute: '#555C52', foot: '#202923', footFg: '#FFFFFF', footSub: '#BFD0D8', footIcon: '#85A4BD',
      tiles: [['#202923', '#FFFFFF'], ['#555C52', '#FFFFFF'], ['#85A4BD', '#202923'], ['#FFFFFF', '#202923']] } },
  { id: 'lily', name: 'Lily', sw: ['#C6BBB1', '#8E8E5D', '#212414', '#C3A0A2'],
    open: { bg: '#212414', fg: '#FFFFFF', a: '#C3A0A2', b: '#8E8E5D', ring: '#C6BBB1', kicker: '#C3A0A2', sub: '#C6BBB1' },
    rides: { bg: '#C3A0A2', fg: '#212414', ring: '#C6BBB1', b: '#8E8E5D', card: '#212414', cardFg: '#FFFFFF', cardKicker: '#C3A0A2', cardSub: '#C6BBB1' },
    queue: { bg: '#C6BBB1', fg: '#212414', stripe: '#212414', circle: '#C3A0A2', chipBg: '#212414', chipIcon: '#C3A0A2', chipText: '#FFFFFF' },
    walk: { bg: '#8E8E5D', fg: '#212414', path: '#C6BBB1', circle: '#C3A0A2', sub: '#212414' },
    snacks: { bg: '#C6BBB1', fg: '#212414', circleA: '#C3A0A2', circleB: '#8E8E5D', rowBg: '#FFFFFF', rowFg: '#212414', count: '#212414' },
    persona: { bg: '#212414', fg: '#FFFFFF', star: '#C3A0A2', disc: '#C6BBB1', discIcon: '#212414', kicker: '#C3A0A2', sub: '#C6BBB1' },
    summary: { bg: '#C6BBB1', fg: '#212414', kicker: '#212414', panel: '#FFFFFF', mute: '#5C5C3D', foot: '#212414', footFg: '#FFFFFF', footSub: '#C6BBB1', footIcon: '#C3A0A2',
      tiles: [['#212414', '#FFFFFF'], ['#8E8E5D', '#212414'], ['#C3A0A2', '#212414'], ['#FFFFFF', '#212414']] } },
  { id: 'candlelit', name: 'Candlelit', sw: ['#651F30', '#A8697A', '#EDDFC4', '#B7BB88'],
    open: { bg: '#3E2C22', fg: '#EDDFC4', a: '#651F30', b: '#6E6B41', ring: '#B7BB88', kicker: '#B7BB88', sub: '#EDDFC4' },
    rides: { bg: '#651F30', fg: '#EDDFC4', ring: '#A8697A', b: '#B7BB88', card: '#EDDFC4', cardFg: '#3E2C22', cardKicker: '#651F30', cardSub: '#5A463A' },
    queue: { bg: '#EDDFC4', fg: '#3E2C22', stripe: '#651F30', circle: '#A8697A', chipBg: '#3E2C22', chipIcon: '#B7BB88', chipText: '#FFFFFF' },
    walk: { bg: '#6E6B41', fg: '#FFFFFF', path: '#B7BB88', circle: '#651F30', sub: '#F3EBDB' },
    snacks: { bg: '#B7BB88', fg: '#3E2C22', circleA: '#651F30', circleB: '#6E6B41', rowBg: '#FFFFFF', rowFg: '#3E2C22', count: '#651F30' },
    persona: { bg: '#651F30', fg: '#EDDFC4', star: '#B7BB88', disc: '#EDDFC4', discIcon: '#651F30', kicker: '#B7BB88', sub: '#EDDFC4' },
    summary: { bg: '#EDDFC4', fg: '#3E2C22', kicker: '#651F30', panel: '#FFFFFF', mute: '#5A463A', foot: '#3E2C22', footFg: '#EDDFC4', footSub: '#B7BB88', footIcon: '#A8697A',
      tiles: [['#651F30', '#FFFFFF'], ['#6E6B41', '#FFFFFF'], ['#B7BB88', '#3E2C22'], ['#3E2C22', '#EDDFC4']] } },
  { id: 'harvest', name: 'Harvest', sw: ['#371E13', '#A85530', '#E1D3A9', '#534B31'],
    open: { bg: '#371E13', fg: '#E1D3A9', a: '#A85530', b: '#534B31', ring: '#C0AA8A', kicker: '#C0AA8A', sub: '#E1D3A9' },
    rides: { bg: '#A85530', fg: '#FFFFFF', ring: '#5E2A25', b: '#E1D3A9', card: '#E1D3A9', cardFg: '#371E13', cardKicker: '#5E2A25', cardSub: '#5A3F2A' },
    queue: { bg: '#E1D3A9', fg: '#371E13', stripe: '#5E2A25', circle: '#A85530', chipBg: '#371E13', chipIcon: '#C0AA8A', chipText: '#FFFFFF' },
    walk: { bg: '#534B31', fg: '#E1D3A9', path: '#C0AA8A', circle: '#A85530', sub: '#E1D3A9' },
    snacks: { bg: '#C0AA8A', fg: '#371E13', circleA: '#A85530', circleB: '#8F7C3A', rowBg: '#FFFFFF', rowFg: '#371E13', count: '#A85530' },
    persona: { bg: '#5E2A25', fg: '#E1D3A9', star: '#C0AA8A', disc: '#8F7C3A', discIcon: '#371E13', kicker: '#C0AA8A', sub: '#E1D3A9' },
    summary: { bg: '#E1D3A9', fg: '#371E13', kicker: '#5E2A25', panel: '#FFFFFF', mute: '#5A3F2A', foot: '#371E13', footFg: '#E1D3A9', footSub: '#C0AA8A', footIcon: '#A85530',
      tiles: [['#5E2A25', '#FFFFFF'], ['#A85530', '#FFFFFF'], ['#8F7C3A', '#1A0E08'], ['#534B31', '#E1D3A9']] } },
  { id: 'parisian', name: 'Parisian', sw: ['#B1C7D4', '#849AAD', '#605246', '#5E1C23'],
    open: { bg: '#605246', fg: '#FFFFFF', a: '#5E1C23', b: '#849AAD', ring: '#B1C7D4', kicker: '#D6E2E9', sub: '#D6E2E9' },
    rides: { bg: '#849AAD', fg: '#2A2019', ring: '#B1C7D4', b: '#5E1C23', card: '#5E1C23', cardFg: '#FFFFFF', cardKicker: '#B1C7D4', cardSub: '#E6D9DB' },
    queue: { bg: '#B1C7D4', fg: '#3A2F27', stripe: '#5E1C23', circle: '#A1947F', chipBg: '#605246', chipIcon: '#B1C7D4', chipText: '#FFFFFF' },
    walk: { bg: '#5E1C23', fg: '#FFFFFF', path: '#B1C7D4', circle: '#849AAD', sub: '#E6D9DB' },
    snacks: { bg: '#A1947F', fg: '#2A2019', circleA: '#5E1C23', circleB: '#B1C7D4', rowBg: '#FFFFFF', rowFg: '#2A2019', count: '#5E1C23' },
    persona: { bg: '#605246', fg: '#FFFFFF', star: '#B1C7D4', disc: '#849AAD', discIcon: '#605246', kicker: '#D6E2E9', sub: '#D6E2E9' },
    summary: { bg: '#B1C7D4', fg: '#2A2019', kicker: '#5E1C23', panel: '#FFFFFF', mute: '#605246', foot: '#605246', footFg: '#FFFFFF', footSub: '#D6E2E9', footIcon: '#849AAD',
      tiles: [['#5E1C23', '#FFFFFF'], ['#605246', '#FFFFFF'], ['#849AAD', '#2A2019'], ['#A1947F', '#2A2019']] } },
  { id: 'champagne', name: 'Champagne', sw: ['#150C0C', '#85431E', '#D39858', '#EACEAA'],
    open: { bg: '#150C0C', fg: '#EACEAA', a: '#85431E', b: '#D39858', ring: '#D39858', kicker: '#D39858', sub: '#EACEAA' },
    rides: { bg: '#85431E', fg: '#EACEAA', ring: '#34150F', b: '#D39858', card: '#EACEAA', cardFg: '#150C0C', cardKicker: '#85431E', cardSub: '#5A3A28' },
    queue: { bg: '#EACEAA', fg: '#34150F', stripe: '#34150F', circle: '#D39858', chipBg: '#34150F', chipIcon: '#D39858', chipText: '#FFFFFF' },
    walk: { bg: '#34150F', fg: '#EACEAA', path: '#D39858', circle: '#85431E', sub: '#EACEAA' },
    snacks: { bg: '#D39858', fg: '#150C0C', circleA: '#85431E', circleB: '#EACEAA', rowBg: '#FFFFFF', rowFg: '#150C0C', count: '#85431E' },
    persona: { bg: '#150C0C', fg: '#EACEAA', star: '#D39858', disc: '#85431E', discIcon: '#EACEAA', kicker: '#D39858', sub: '#EACEAA' },
    summary: { bg: '#EACEAA', fg: '#150C0C', kicker: '#85431E', panel: '#FFFFFF', mute: '#5A3A28', foot: '#34150F', footFg: '#EACEAA', footSub: '#D39858', footIcon: '#D39858',
      tiles: [['#34150F', '#EACEAA'], ['#85431E', '#FFFFFF'], ['#D39858', '#150C0C'], ['#150C0C', '#EACEAA']] } },
  { id: 'riviera', name: 'Riviera', sw: ['#933B5B', '#B5728A', '#AABAAE', '#E3D6BF'],
    open: { bg: '#933B5B', fg: '#E3D6BF', a: '#B5728A', b: '#AABAAE', ring: '#E3D6BF', kicker: '#E3D6BF', sub: '#E3D6BF' },
    rides: { bg: '#AABAAE', fg: '#3A1E2A', ring: '#E3D6BF', b: '#933B5B', card: '#933B5B', cardFg: '#FFFFFF', cardKicker: '#E3D6BF', cardSub: '#F3E9EE' },
    queue: { bg: '#E3D6BF', fg: '#933B5B', stripe: '#933B5B', circle: '#B5728A', chipBg: '#933B5B', chipIcon: '#E3D6BF', chipText: '#FFFFFF' },
    walk: { bg: '#9F9679', fg: '#3A1E2A', path: '#E3D6BF', circle: '#933B5B', sub: '#3A1E2A' },
    snacks: { bg: '#B5728A', fg: '#2A1420', circleA: '#933B5B', circleB: '#AABAAE', rowBg: '#FFFFFF', rowFg: '#3A1E2A', count: '#933B5B' },
    persona: { bg: '#933B5B', fg: '#FFFFFF', star: '#E3D6BF', disc: '#AABAAE', discIcon: '#933B5B', kicker: '#E3D6BF', sub: '#E3D6BF' },
    summary: { bg: '#E3D6BF', fg: '#3A1E2A', kicker: '#933B5B', panel: '#FFFFFF', mute: '#6B4A58', foot: '#933B5B', footFg: '#FFFFFF', footSub: '#E3D6BF', footIcon: '#AABAAE',
      tiles: [['#933B5B', '#FFFFFF'], ['#AABAAE', '#3A1E2A'], ['#B5728A', '#2A1420'], ['#9F9679', '#3A1E2A']] } },
  { id: 'christmas', name: 'Christmas', sw: ['#7E2625', '#292F17', '#F1ECDB', '#868859'],
    open: { bg: '#292F17', fg: '#F1ECDB', a: '#7E2625', b: '#868859', ring: '#F1ECDB', kicker: '#F1ECDB', sub: '#F1ECDB' },
    rides: { bg: '#7E2625', fg: '#F1ECDB', ring: '#3C1B0F', b: '#868859', card: '#F1ECDB', cardFg: '#3C1B0F', cardKicker: '#7E2625', cardSub: '#5A4030' },
    queue: { bg: '#F1ECDB', fg: '#3C1B0F', stripe: '#7E2625', circle: '#868859', chipBg: '#292F17', chipIcon: '#F1ECDB', chipText: '#FFFFFF' },
    walk: { bg: '#868859', fg: '#14170B', path: '#F1ECDB', circle: '#7E2625', sub: '#14170B' },
    snacks: { bg: '#F1ECDB', fg: '#3C1B0F', circleA: '#7E2625', circleB: '#292F17', rowBg: '#FFFFFF', rowFg: '#3C1B0F', count: '#7E2625' },
    persona: { bg: '#3C1B0F', fg: '#F1ECDB', star: '#F1ECDB', disc: '#7E2625', discIcon: '#F1ECDB', kicker: '#C9CB9A', sub: '#F1ECDB' },
    summary: { bg: '#F1ECDB', fg: '#3C1B0F', kicker: '#7E2625', panel: '#FFFFFF', mute: '#5A4030', foot: '#292F17', footFg: '#F1ECDB', footSub: '#C9CB9A', footIcon: '#7E2625',
      tiles: [['#7E2625', '#F1ECDB'], ['#292F17', '#F1ECDB'], ['#868859', '#14170B'], ['#3C1B0F', '#F1ECDB']] } },
];

// Which palette each area opens in ("Picked for you")
const LAND_PALETTE = {
  'Main Street, U.S.A.': 'candlelit', 'Adventureland': 'lily', 'New Orleans Square': 'haunted', 'Bayou Country': 'haunted',
  'Frontierland': 'harvest', 'Fantasyland': 'riviera', "Mickey's Toontown": 'riviera', 'Tomorrowland': 'lakeside',
  "Star Wars: Galaxy's Edge": 'champagne', 'Hollywood Land': 'champagne', 'Avengers Campus': 'parisian', 'Cars Land': 'harvest',
  'San Fransokyo Square': 'parisian', 'Pixar Pier': 'riviera', 'Paradise Gardens Park': 'riviera', 'Grizzly Peak': 'lily',
  'Discoveryland': 'champagne', 'World Premiere Plaza': 'champagne', 'Marvel Avengers Campus': 'parisian',
  'Worlds of Pixar': 'riviera', 'World of Frozen': 'lakeside', 'Adventure Way': 'lily',
  // Walt Disney World
  'Liberty Square': 'haunted', 'World Celebration': 'lakeside', 'World Discovery': 'parisian', 'World Nature': 'lily',
  'World Showcase': 'candlelit', 'Hollywood Boulevard': 'champagne', 'Sunset Boulevard': 'haunted', 'Echo Lake': 'lakeside',
  'Toy Story Land': 'riviera', 'Animation Courtyard': 'champagne', 'Oasis': 'lily', 'Discovery Island': 'lily',
  'Pandora – The World of Avatar': 'haunted', 'Africa': 'harvest', "Rafiki's Planet Watch": 'harvest', 'Asia': 'christmas',
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WRAP_SLIDES = ['open', 'rides', 'queue', 'walk', 'snacks', 'persona', 'summary'];
const PERSONA_STARS = [[30, 90, 4], [300, 60, 6], [320, 250, 3], [40, 300, 5], [80, 560, 4], [310, 520, 6], [180, 40, 3],
  [250, 600, 3], [20, 470, 3], [340, 400, 4], [130, 610, 5], [60, 200, 3], [290, 330, 3], [200, 320, 2]];

const C = {
  ground: '#F6F7F9', card: '#FFFFFF', ink: '#0F172A', muted: '#475569', line: '#E2E8F0',
  dark: '#0F172A', dark2: '#1E293B', accent: '#C2410C', accentSoft: '#FDBA74', blue: '#1D4ED8',
  green: '#15803D', red: '#B91C1C', redSoft: '#FEE2E2',
};

const MOOD_LABELS = {
  burgers: 'Burgers & chicken', mexican: 'Tex-Mex', pizza: 'Pizza & Italian', asian: 'Asian',
  bbq: 'BBQ', seafood: 'Seafood', sandwiches: 'Sandwiches', comfort: 'Comfort food',
  international: 'International', snack: 'Snacks', sweet: 'Sweet treats', coffee: 'Coffee',
  breakfast: 'Breakfast',
};

// ---------- helpers ----------
function parkNow(offsetMin) {
  const d = new Date(Date.now() + offsetMin * 60000); // read with getUTC*
  const day = d.getUTCDay();
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dow: day,
    dayType: day === 0 || day === 6 ? 'weekend' : 'weekday',
    dateKey: d.toISOString().slice(0, 10),
  };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function minutesAgo(ts) {
  if (!ts) return null;
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr${h === 1 ? '' : 's'} ago`;
}

// The best "typical day" curve we have: this exact weekday if we've seen enough
// of it, otherwise weekday/weekend.
function typicalFor(ride, dow, dayType) {
  const t = ride.typical;
  if (!t) return null;
  const day = t.dow && t.dow[dow];
  if (day && day.filter((v) => v != null).length >= 4) return day;
  const fallback = t[dayType];
  return fallback && fallback.some((v) => v != null) ? fallback : null;
}

function extremes(curve) {
  if (!curve) return null;
  let busiest = null, quietest = null;
  curve.forEach((v, h) => {
    if (v == null) return;
    if (!busiest || v > busiest.wait) busiest = { hour: h, wait: v };
    if (!quietest || v < quietest.wait) quietest = { hour: h, wait: v };
  });
  return busiest ? { busiest, quietest } : null;
}

// "08:00" -> "8am", "21:30" -> "9:30pm"
// Paris uses the 24-hour clock (14:30); Anaheim and Orlando use 2:30pm. Set from the chosen resort on every render.
let CLOCK24 = false;
const pad2 = (n) => String(n).padStart(2, '0');

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (CLOCK24) return `${pad2(h % 24)}:${pad2(m || 0)}`;
  const suffix = h >= 12 && h < 24 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (h === 0 && m === 0) return 'midnight';
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// open/close ranges ([["08:00","22:00"]]) -> is it open at `minute`?
function openAt(ranges, minute) {
  return (ranges || []).some(([o, c]) => {
    const start = toMin(o); let end = toMin(c);
    if (end <= start) end += 24 * 60; // closes after midnight
    return (minute >= start && minute < end) || (minute + 1440 >= start && minute + 1440 < end);
  });
}

// ThemeParks.wiki schedule -> today's hours for a park
function parkHoursToday(schedule, dateKey) {
  const today = (schedule || []).filter((x) => x.date === dateKey && x.openingTime && x.closingTime);
  const main = today.filter((x) => x.type === 'OPERATING')
    .map((x) => [x.openingTime.slice(11, 16), x.closingTime.slice(11, 16)]);
  const extras = today.filter((x) => x.type === 'EXTRA_HOURS' || x.type === 'TICKETED_EVENT')
    .map((x) => ({
      label: x.description || (x.type === 'EXTRA_HOURS' ? 'Extra hours' : 'Special ticketed event'),
      range: [x.openingTime.slice(11, 16), x.closingTime.slice(11, 16)],
    }));
  return { known: (schedule || []).length > 0, main, extras };
}

const fmtRange = ([o, c]) => `${fmtTime(o)} – ${fmtTime(c)}`;
const nextDateKey = (dateKey) => new Date(Date.parse(`${dateKey}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const shortPark = (name) => (name || '').replace('Disney California Adventure Park', 'California Adventure')
  .replace("Disney's ", '').replace(' Theme Park', '').replace(' Park', '');
const clockFromMs = (ms, offsetMin) => {
  const d = new Date(ms + offsetMin * 60000);
  return fmtTime(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
};
const BIG_SHOW = /firework|parade|world of color|fantasmic|nighttime|spectacular|believe|cascade|tales of magic|electrical|illumination/i;

// Rope drop: which picks gain the most wait between opening and midday?
// Headline rides come first; a smaller ride only makes the cut if history
// shows its line really balloons (20+ min) after opening.
function ropeDropPicks(rides, openHour, parkName) {
  const head = (HEADLINERS[parkName] || []).map(norm);
  const scored = rides.map((r) => {
    const curve = r.typical && (r.typical.weekday || r.typical.weekend);
    let gain = null;
    if (curve && curve[openHour] != null) {
      const later = [1, 2, 3, 4].map((i) => curve[openHour + i]).filter((v) => v != null);
      if (later.length) gain = Math.max(...later) - curve[openHour];
    }
    const rank = head.indexOf(norm(r.name));
    return { r, gain, headliner: rank !== -1, rank: rank === -1 ? 99 : rank };
  }).filter((x) => x.headliner || (x.gain != null && x.gain >= 20));
  scored.sort((a, b) => {
    if (a.gain != null && b.gain != null && Math.abs(a.gain - b.gain) >= 10) return b.gain - a.gain;
    if (a.headliner !== b.headliner) return a.headliner ? -1 : 1;
    return a.rank - b.rank;
  });
  return scored.slice(0, 3).map((x) => x.r);
}

function fmtHour(h) {
  if (CLOCK24) return `${pad2(h % 24)}:00`;
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function walkMinutes(from, to) {
  if (!from || !to) return null;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (to[0] - from[0]) * rad, dLon = (to[1] - from[1]) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from[0] * rad) * Math.cos(to[0] * rad) * Math.sin(dLon / 2) ** 2;
  const metres = 2 * R * Math.asin(Math.sqrt(a)) * 1.3; // paths aren't straight lines
  return Math.max(1, Math.round(metres / 75)); // ~4.5 km/h
}

function priceDollars(price) {
  if (!price || price.amount == null) return null;
  return price.amount >= 100 ? Math.round(price.amount / 100) : Math.round(price.amount);
}

function parseLive(json) {
  const map = {};
  (json.liveData || []).forEach((e) => {
    const q = e.queue || {};
    map[e.id] = {
      name: e.name,
      type: e.entityType,
      status: e.status,
      updated: e.lastUpdated || null,
      singleRider: q.SINGLE_RIDER && q.SINGLE_RIDER.waitTime != null ? q.SINGLE_RIDER.waitTime : null,
      multiReturn: q.RETURN_TIME && q.RETURN_TIME.returnStart ? q.RETURN_TIME.returnStart.slice(11, 16) : null,
      showtimes: (e.showtimes || []).map((t) => t.startTime).filter(Boolean),
      wait: q.STANDBY && q.STANDBY.waitTime != null ? q.STANDBY.waitTime : null,
      multi: q.RETURN_TIME ? q.RETURN_TIME.state : null,
      single: q.PAID_RETURN_TIME
        ? { state: q.PAID_RETURN_TIME.state, price: priceDollars(q.PAID_RETURN_TIME.price) }
        : null,
    };
  });
  return map;
}

// What history says about a ride right now
function outlook(ride, now, liveWait, closeHour = 24) {
  const typ = typicalFor(ride, now.dow, now.dayType);
  if (!typ) return { trend: 'unknown' };
  const when = whenToRide(typ, now, liveWait, closeHour);
  const usualNow = typ[now.hour];
  const cur = liveWait != null ? liveWait : usualNow;
  const scale = liveWait != null && usualNow ? Math.min(1.6, Math.max(0.6, liveWait / usualNow)) : 1;
  const next = [1, 2, 3].map((i) => typ[now.hour + i]).filter((v) => v != null).map((v) => Math.round(v * scale));
  let best = null;
  for (let h = now.hour + 1; h < 24; h++) {
    if (typ[h] != null && (!best || typ[h] < best.wait)) best = { hour: h, wait: typ[h] };
  }
  if (cur == null || next.length === 0) return { trend: 'unknown', best, when };
  const later = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
  const diff = later - cur;
  const trend = diff >= 8 ? 'up' : diff <= -8 ? 'down' : 'steady';
  return { trend, later, diff, best, when };
}

// Ride now, or wait for a quieter hour later today? Uses the typical curve for this
// day, scaled by how busy today is compared with a typical day (live wait vs usual now).
// Only says "wait" when it saves at least 10 min and a quarter of the line.
function whenToRide(typ, now, liveWait, closeHour) {
  const usualNow = typ[now.hour];
  const cur = liveWait != null ? liveWait : usualNow;
  if (cur == null) return null;
  const scale = liveWait != null && usualNow ? Math.min(1.6, Math.max(0.6, liveWait / usualNow)) : 1;
  const hours = [];
  for (let h = now.hour + 1; h < Math.min(24, closeHour); h++) {
    if (typ[h] != null) hours.push({ hour: h, wait: Math.max(5, Math.round((typ[h] * scale) / 5) * 5) });
  }
  const good = hours.filter((x) => cur - x.wait >= 10 && x.wait <= cur * 0.75);
  if (!good.length) return { now: true, wait: cur };
  // the earliest hour that gets most of the saving, so not every ride says "come back at closing"
  const maxSave = Math.max(...good.map((x) => cur - x.wait));
  const pick = good.find((x) => cur - x.wait >= maxSave * 0.6);
  return { now: false, hour: pick.hour, wait: pick.wait, save: cur - pick.wait };
}

function lightningLane(live, look, R) {
  const now = live.wait != null ? live.wait : null;
  const ref = [now, look.best ? look.best.wait : null].filter((v) => v != null);
  const bestStandby = ref.length ? Math.min(...ref) : null;
  const saved = bestStandby != null ? Math.max(0, bestStandby - LL_WAIT) : null;
  const when = look.best && look.best.wait === bestStandby ? ` around ${fmtHour(look.best.hour)}` : ' right now';

  if (live.single && live.single.state === 'AVAILABLE') {
    const price = live.single.price;
    if (saved == null) return { verdict: 'Maybe', tone: 'amber', body: `${R.payName} is on sale, but there isn't enough wait data to judge it yet.`, price };
    if (saved < 15) return { verdict: 'Skip it', tone: 'grey', body: `The standby line is about ${bestStandby} min${when}. Ride standby and keep your money.`, price };
    const perHour = price ? ` That's about ${R.cur}${Math.round((price * 60) / saved)} for every hour saved.` : '';
    if (saved >= 30) return { verdict: 'Worth it', tone: 'green', body: `Even at its best today, standby is about ${bestStandby} min. ${R.payName} saves you roughly ${saved} min.${perHour}`, price };
    return { verdict: 'Maybe', tone: 'amber', body: `Saves about ${saved} min compared with standby${when}.${perHour} Worth it if your day is packed.`, price };
  }
  if (live.multi === 'AVAILABLE') {
    if (saved != null && saved >= 15) return { verdict: 'Use it', tone: 'green', body: `If you have Lightning Lane Multi Pass, book this one: it saves about ${saved} min.` };
    return { verdict: 'Save it', tone: 'grey', body: `This ride is part of Multi Pass, but standby is short${when}. Use your booking on a busier ride.` };
  }
  if ((live.single && live.single.state === 'FINISHED') || live.multi === 'FINISHED') {
    return { verdict: 'Sold out', tone: 'grey', body: `${R.payShort} for this ride has run out for today.` };
  }
  return { verdict: 'Not offered', tone: 'grey', body: `No ${R.payShort} for this ride right now.` };
}

const TONES = {
  green: { bg: '#DCFCE7', fg: '#14532D' }, amber: { bg: '#FEF3C7', fg: '#78350F' }, grey: { bg: '#F1F5F9', fg: '#334155' },
};

// ---------- app ----------
function RideNext() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [parkIdx, setParkIdx] = useState(0);
  const [live, setLive] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [screen, setScreen] = useState('welcome');
  const [detailId, setDetailId] = useState(null);
  const [saved, setSaved] = useState({
    selected: {}, done: {}, useLoc: false, hopper: false, useSingle: false, multiPass: false, rain: false,
    resort: null, minHeightCm: null, watch: [], noRemind: [], locAsked: false, deviceId: null, shareStats: true, queue: null, outbox: [], customSnacks: [], log: {}, ll: null, reminders: {},
    snackCounts: {}, meals: {}, areas: {}, day: null, stepsAndroid: {}, waitAlerts: {}, ratings: {},
  });
  const [snacksOpen, setSnacksOpen] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [backTo, setBackTo] = useState('welcome');
  const [wrapSlide, setWrapSlide] = useState(0);
  const [wrapPal, setWrapPal] = useState(null);
  const slideRef = useRef(null);
  const touchRef = useRef(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const [steps, setSteps] = useState(null);
  const [banner, setBanner] = useState(null);
  const [showsOpen, setShowsOpen] = useState(false);
  const [newSnack, setNewSnack] = useState('');
  const savedRef = useRef(saved);
  const prevLive = useRef({});
  const [skippedBy, setSkippedBy] = useState({});
  const [coords, setCoords] = useState(null);
  const [foodOpen, setFoodOpen] = useState(false);
  const [mood, setMood] = useState(null);
  const [sortBy, setSortBy] = useState('best'); // 'best' | 'area'
  const [schedules, setSchedules] = useState({}); // parkId -> schedule list
  const [, setTick] = useState(0);
  const [recapAdd, setRecapAdd] = useState(null); // 'ride' | 'meal' | 'snack' while adding on the Day Recap
  const [recapQuery, setRecapQuery] = useState('');
  const [introDone, setIntroDone] = useState(false); // show the branded loading screen for at least a moment
  useEffect(() => { const t = setTimeout(() => setIntroDone(true), 1400); return () => clearTimeout(t); }, []);
  const [fans, setFans] = useState(null); // what Ride Next fans report: real waits, top snacks, ratings
  const apiRef = useRef(null);
  const sendingRef = useRef(false);
  const loaded = useRef(false);

  const R = RESORTS[saved.resort] || RESORTS.dlr;
  CLOCK24 = !!R.clock24;
  const park = data ? (data.parks[parkIdx] || data.parks[0]) : null;
  const now = data ? parkNow(data.utcOffsetMinutes) : null;

  // load saved choices
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw);
        // earlier versions: Disneyland only, heights in inches
        if (stored.minHeight != null && stored.minHeightCm == null) stored.minHeightCm = Math.round(stored.minHeight * 2.54);
        if (!stored.resort && Object.values(stored.selected || {}).some((l) => l && l.length)) stored.resort = 'dlr';
        setSaved((prev) => ({ ...prev, ...stored }));
      })
      .catch(() => {})
      .finally(() => { loaded.current = true; setStoreReady(true); });
  }, []);

  // ---------- anonymous fan stats ----------
  // a random ID for this phone (not linked to the person), made once
  useEffect(() => {
    if (storeReady && !saved.deviceId) {
      const id = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
      setSaved((cur) => ({ ...cur, deviceId: cur.deviceId || id }));
    }
  }, [storeReady, saved.deviceId]);

  // find the stats server, then load what fans report for this resort (every 30 minutes)
  useEffect(() => {
    if (!saved.resort) return undefined;
    let alive = true;
    const load = async () => {
      try {
        if (!apiRef.current) {
          const a = await fetch(`${DATA_BASE}api.json?ts=${Date.now()}`).then((r) => (r.ok ? r.json() : null));
          apiRef.current = a && a.url ? a.url : null;
        }
        if (!apiRef.current) return;
        const sum = await fetch(`${apiRef.current}/v1/summary?resort=${saved.resort}`).then((r) => (r.ok ? r.json() : null));
        if (alive && sum) setFans(sum);
      } catch (e) { /* offline: try again later */ }
    };
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [saved.resort]);

  // queue an anonymous event; sent in the background, nothing is sent if sharing is off
  const queueEvent = (ev) => setSaved((cur) => (cur.shareStats === false ? cur
    : { ...cur, outbox: [...(cur.outbox || []), { ...ev, resort: ev.resort || cur.resort }].slice(-200) }));

  const flushOutbox = useCallback(async () => {
    const sv = savedRef.current;
    if (sendingRef.current || !apiRef.current || !sv.deviceId || sv.shareStats === false) return;
    const box = sv.outbox || [];
    if (!box.length) return;
    const resort = box[0].resort;
    const batch = [];
    for (const e of box) { if (e.resort !== resort || batch.length >= 50) break; batch.push(e); }
    sendingRef.current = true;
    try {
      const res = await fetch(`${apiRef.current}/v1/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: sv.deviceId, resort, events: batch.map(({ resort: _r, ...e }) => e) }),
      });
      // sent, or rejected as bad data: drop them. Busy or offline: keep and retry later
      if (res.ok || res.status === 400 || res.status === 413) {
        setSaved((cur) => ({ ...cur, outbox: (cur.outbox || []).slice(batch.length) }));
      }
    } catch (e) { /* offline */ } finally { sendingRef.current = false; }
  }, []);
  useEffect(() => {
    if ((saved.outbox || []).length) { const t = setTimeout(flushOutbox, 3000); return () => clearTimeout(t); }
    return undefined;
  }, [saved.outbox, flushOutbox, fans]);

  // what fans actually waited, scaled to the wait posted now
  const fanWait = (rideId, posted) => {
    const f = fans && fans.waits && fans.waits[rideId];
    if (!f || !posted) return null;
    const est = Math.max(1, Math.round(posted * f.ratio));
    return { est, n: f.n, same: Math.abs(est - posted) < 3 };
  };

  // load the chosen resort's park data
  useEffect(() => {
    if (!storeReady || !saved.resort) return undefined;
    let alive = true;
    setData(null); setLive({}); setSchedules({}); setParkIdx(0); setError(null);
    prevLive.current = {};
    fetch(RESORTS[saved.resort].dataUrl)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        d.parks.forEach((p) => p.rides.forEach((r) => { r.parkId = p.id; r.parkName = p.name; }));
        if (alive) setData(d);
      })
      .catch((e) => { if (alive) setError(`Couldn't load park data (${e.message}).`); });
    return () => { alive = false; };
  }, [storeReady, saved.resort]);

  useEffect(() => {
    if (!data) return;
    data.parks.forEach((p) => {
      fetch(SCHEDULE_URL(p.id))
        .then((r) => r.json())
        .then((j) => setSchedules((cur) => ({ ...cur, [p.id]: j.schedule || [] })))
        .catch(() => {});
    });
  }, [data]);

  // today's park hours: live schedule if we have it, otherwise last night's copy
  const hoursFor = (p, dateKeyIn) => {
    const dateKey = dateKeyIn || parkNow(data.utcOffsetMinutes).dateKey;
    if (schedules[p.id]) return parkHoursToday(schedules[p.id], dateKey);
    const saved = p.hours && p.hours[dateKey];
    return { known: !!p.hours && Object.keys(p.hours).length > 0, main: saved || [], extras: [] };
  };
  // hour the park closes today (24 if unknown or past midnight), so "ride later" never points after close
  const closeHourFor = (parkId) => {
    const p = data && data.parks.find((x) => x.id === parkId);
    const range = p && (hoursFor(p).main || [])[0];
    if (!range) return 24;
    const c = Math.ceil(toMin(range[1]) / 60);
    return c > Math.floor(toMin(range[0]) / 60) ? c : 24;
  };
  // Crowd level: an estimate from live posted waits (Disney doesn't publish real park capacity)
  const crowdFor = (p) => {
    if (!p || !now) return null;
    const waits = [], usual = [];
    p.rides.forEach((r) => {
      const l = live[r.id];
      if (!l || l.status !== 'OPERATING' || l.wait == null) return;
      waits.push(l.wait);
      const t = typicalFor(r, now.dow, now.dayType);
      if (t && t[now.hour] != null) usual.push(t[now.hour]);
    });
    if (waits.length < 4) return null; // closed, or too few rides reporting
    const avg = waits.reduce((a, b) => a + b, 0) / waits.length;
    const steps = [8, 13, 18, 24, 30, 37, 44, 52, 62];
    const level = 1 + steps.filter((x) => avg >= x).length;
    let vsUsual = null;
    if (usual.length >= Math.max(4, waits.length * 0.5)) {
      const typ = usual.reduce((a, b) => a + b, 0) / usual.length;
      const ratio = avg / Math.max(1, typ);
      const when = `a typical ${DAY_NAMES[now.dow]} at ${fmtHour(now.hour)}`;
      vsUsual = ratio < 0.8 ? `Quieter than ${when}` : ratio > 1.2 ? `Busier than ${when}` : `About normal for ${when}`;
    }
    const tip = level <= 3 ? 'Quiet: a great time to do the headliners'
      : level <= 6 ? 'Steady: stick to your plan and use Single Rider where you can'
        : level <= 8 ? `Busy: use Single Rider and ${R.payShort}`
          : `Very busy: ${R.payShort} for headliners, and do food and shows now`;
    const label = level <= 3 ? 'Quiet' : level <= 6 ? 'Moderate' : level <= 8 ? 'Busy' : 'Very busy';
    return { level, avg: Math.round(avg), vsUsual, tip, label };
  };

  const hoursLine = (p) => {
    const h = hoursFor(p);
    if (h.main.length) return `Open today ${h.main.map(fmtRange).join(', ')}`;
    return h.known ? 'Closed today' : 'Hours not available';
  };

  useEffect(() => {
    savedRef.current = saved;
    if (loaded.current) AsyncStorage.setItem(STORE_KEY, JSON.stringify(saved)).catch(() => {});
  }, [saved]);

  const refreshLocation = useCallback(async () => {
    if (!saved.useLoc) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = [pos.coords.latitude, pos.coords.longitude];
      setCoords(here);
      if (data && savedRef.current.day) {
        let best = null;
        data.parks.forEach((p) => p.rides.forEach((r) => {
          const w = walkMinutes(here, r.loc);
          if (r.land && r.land !== 'Other' && w != null && w <= 3 && (!best || w < best.w)) best = { w, land: r.land };
        }));
        if (best) {
          const key = parkNow(data.utcOffsetMinutes).dateKey;
          setSaved((cur) => {
            const list = (cur.areas || {})[key] || [];
            return list.includes(best.land) ? cur : { ...cur, areas: { [key]: [...list, best.land] } };
          });
        }
      }
    } catch (e) { /* keep last known */ }
  }, [saved.useLoc, data]);

  const refreshLive = useCallback(async () => {
    if (!data) return;
    try {
      const all = await Promise.all(data.parks.map((p) => fetch(LIVE_URL(p.id)).then((r) => r.json())));
      const merged = {};
      all.forEach((j, i) => {
        const m = parseLive(j);
        Object.values(m).forEach((v) => { v.parkId = data.parks[i].id; });
        Object.assign(merged, m);
      });

      // "It's back up!" — any watched ride, or any ride on your list, that just reopened
      const sv = savedRef.current;
      const asked = new Set(sv.watch || []);
      const muted = new Set(sv.noRemind || []);
      const auto = new Set(Object.values(sv.selected || {}).flat().filter((id) => !muted.has(id)));
      const opened = (id) => { const b = prevLive.current[id], a = merged[id]; return b && a && b.status !== 'OPERATING' && a.status === 'OPERATING'; };
      const backUp = [...new Set([...asked, ...auto])].filter((id) => opened(id) && prevLive.current[id].status === 'DOWN');
      const nowOpen = [...asked].filter((id) => opened(id) && prevLive.current[id].status !== 'DOWN');
      if (backUp.length || nowOpen.length) {
        Vibration.vibrate([0, 300, 150, 300]);
        const b = backUp.map((id) => merged[id].name), o = nowOpen.map((id) => merged[id].name);
        setBanner([b.length ? `It's back up! ${b.join(', ')} just reopened. Lines are short right now.` : '',
          o.length ? `It's open! ${o.join(', ')} just opened.` : ''].filter(Boolean).join(' '));
        b.forEach((n) => notifyNow("It's back up!", `${n} just reopened. Lines are short right now, head over!`));
        o.forEach((n) => notifyNow("It's open!", `${n} just opened. Head over before the line builds!`));
        const fired = new Set([...backUp, ...nowOpen]);
        setSaved((cur) => ({ ...cur, watch: (cur.watch || []).filter((id) => !fired.has(id)),
          noRemind: (cur.noRemind || []).filter((id) => !fired.has(id)) }));
      }
      const alerts = sv.waitAlerts || {};
      const hits = Object.entries(alerts).filter(([id, target]) => {
        const v = merged[id];
        return v && v.status === 'OPERATING' && v.wait != null && v.wait <= target;
      });
      if (hits.length) {
        Vibration.vibrate([0, 300, 150, 300]);
        const msgs = hits.map(([id, target]) => `${merged[id].name} is down to ${merged[id].wait} min (your target was ${target})`);
        setBanner(`${msgs.join('. ')}. Go now!`);
        hits.forEach(([id, target]) => notifyNow(`${merged[id].name}: ${merged[id].wait} min`, `It hit your ${target}-minute target. Go now!`));
        setSaved((cur) => {
          const next = { ...(cur.waitAlerts || {}) };
          hits.forEach(([id]) => { delete next[id]; });
          return { ...cur, waitAlerts: next };
        });
      }

      prevLive.current = merged;
      setLive(merged);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError('Couldn\'t get live wait times. Pull down to try again.');
    }
    refreshLocation();
  }, [data, refreshLocation]);

  // check every minute while something you care about is down, otherwise every 3
  const watchedDown = useMemo(() => {
    const ids = new Set([...(saved.watch || []), ...Object.values(saved.selected || {}).flat()]);
    return [...ids].some((id) => live[id] && live[id].status === 'DOWN');
  }, [live, saved.watch, saved.selected]);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, watchedDown ? FAST_REFRESH_MS : REFRESH_MS);
    const clock = setInterval(() => setTick((n) => n + 1), 30000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [refreshLive, watchedDown]);

  const onPull = async () => { setRefreshing(true); await refreshLive(); setRefreshing(false); };

  const toggleLoc = async (on) => {
    if (on) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
    }
    setSaved((s) => ({ ...s, useLoc: on }));
  };

  const selected = (park && saved.selected[park.id]) || [];
  const doneKey = park && now ? `${now.dateKey}:${park.id}` : '';
  const done = saved.done[doneKey] || [];
  const doneFor = (pid) => (now && saved.done[`${now.dateKey}:${pid}`]) || [];
  const skipped = (park && skippedBy[park.id]) || [];
  const skipRide = (ride) => setSkippedBy((k) => {
    const pid = ride.parkId || park.id;
    const cur = (k[pid] || []).filter((x) => x !== ride.id);
    return { ...k, [pid]: [...cur, ride.id] };
  });
  const setOpt = (key, value) => setSaved((cur) => ({ ...cur, [key]: value }));
  // shortest rider: "No limit" unless one of this resort's height options is picked
  const minH = R.heightOptions.map((h) => toCm(R, h)).includes(saved.minHeightCm) ? saved.minHeightCm : null;
  const tooTall = (r) => minH != null && r.heightCm != null && r.heightCm > minH;

  // ---------- Day Recap ----------
  const today = now ? now.dateKey : '';
  const todayLog = (saved.log && saved.log[today]) || [];
  const queueToday = todayLog.reduce((sum, x) => sum + (x.wait || 0), 0);
  const day = saved.day && saved.day.dateKey === today ? saved.day : null;
  const snackCountsToday = (saved.snackCounts && saved.snackCounts[today]) || {};
  const mealsToday = (saved.meals && saved.meals[today]) || {};
  const allSnackNames = useMemo(() => {
    const m = {};
    Object.values(SNACKS).flat().forEach((x) => { m[x.id] = x.name; });
    (saved.customSnacks || []).forEach((x) => { m[x.id] = x.name; });
    return m;
  }, [saved.customSnacks]);

  const startDay = () => setSaved((cur) => (cur.day && cur.day.dateKey === today ? cur
    : { ...cur, day: { dateKey: today, start: Date.now(), end: null } }));
  const endDay = () => setSaved((cur) => ({ ...cur, day: cur.day ? { ...cur.day, end: Date.now() } : cur.day }));
  const bumpSnack = (id, delta) => {
    const n = Math.max(0, (snackCountsToday[id] || 0) + delta);
    if (park && !String(id).startsWith('custom-')) queueEvent({ type: 'snack', parkId: park.id, snack: id, n, day: today });
    bumpSnackCount(id, delta);
  };
  const bumpSnackCount = (id, delta) => setSaved((cur) => {
    const counts = { ...((cur.snackCounts || {})[today] || {}) };
    counts[id] = Math.max(0, (counts[id] || 0) + delta);
    if (!counts[id]) delete counts[id];
    return { ...cur, snackCounts: { [today]: counts } };
  });
  const addCustomSnack = (name) => {
    const clean = name.trim();
    if (!clean) return;
    const id = `custom-${Date.now()}`;
    setSaved((cur) => ({ ...cur, customSnacks: [...(cur.customSnacks || []), { id, name: clean }] }));
    setNewSnack('');
  };
  const removeCustomSnack = (id) => setSaved((cur) => ({ ...cur, customSnacks: (cur.customSnacks || []).filter((x) => x.id !== id) }));
  // Day Recap editing: add rides the app missed, change counts, remove mistakes
  const addRideLog = (ride) => setSaved((cur) => {
    const list = (cur.log || {})[today] || [];
    const dk = `${today}:${ride.parkId}`;
    const done = Object.fromEntries(Object.entries(cur.done || {}).filter(([k]) => k.startsWith(today)));
    return { ...cur, log: { [today]: [...list, { id: ride.id, name: ride.name, parkId: ride.parkId, land: ride.land, wait: 0, at: Date.now(), manual: true }] },
      done: { ...done, [dk]: [...new Set([...(done[dk] || []), ride.id])] } };
  });
  const removeRideLog = (id) => setSaved((cur) => {
    const list = [...((cur.log || {})[today] || [])];
    let i = -1;
    for (let j = list.length - 1; j >= 0; j--) if (list[j].id === id) { i = j; break; }
    if (i < 0) return cur;
    list.splice(i, 1);
    const still = list.some((x) => x.id === id);
    const done = still ? cur.done : Object.fromEntries(Object.entries(cur.done || {})
      .map(([k, v]) => [k, k.startsWith(today) ? v.filter((x) => x !== id) : v]));
    return { ...cur, log: { [today]: list }, done };
  });
  const bumpMeal = (name, delta) => setSaved((cur) => {
    const m = { ...((cur.meals || {})[today] || {}) };
    m[name] = Math.max(0, (m[name] || 0) + delta);
    if (!m[name]) delete m[name];
    return { ...cur, meals: { [today]: m } };
  });

  const ateHere = (f) => setSaved((cur) => {
    const m = { ...((cur.meals || {})[today] || {}) };
    m[f.name] = (m[f.name] || 0) + 1;
    return { ...cur, meals: { [today]: m } };
  });

  // steps: iPhone can count the whole day; Android only while the app is open
  useEffect(() => {
    if (!day) return undefined;
    let sub = null, alive = true;
    (async () => {
      try {
        if (!(await Pedometer.isAvailableAsync())) return;
        await Pedometer.requestPermissionsAsync().catch(() => {});
        const r = await Pedometer.getStepCountAsync(new Date(day.start), new Date(day.end || Date.now()));
        if (alive) setSteps({ count: r.steps, whole: true });
      } catch (e) {
        // Android: no history, so count live while open
        try {
          let last = 0;
          sub = Pedometer.watchStepCount((res) => {
            const add = res.steps - last; last = res.steps;
            if (add > 0) setSaved((cur) => ({ ...cur, stepsAndroid: { [today]: ((cur.stepsAndroid || {})[today] || 0) + add } }));
          });
        } catch (e2) { /* no step counter */ }
      }
    })();
    return () => { alive = false; if (sub) sub.remove(); };
  }, [day && day.start, day && day.end, today, Math.floor(Date.now() / 300000)]);

  const recap = useMemo(() => {
    if (!data || !now) return null;
    const minutes = day ? Math.round(((day.end || Date.now()) - day.start) / 60000) : 0;
    const stepCount = steps && steps.whole ? steps.count : ((saved.stepsAndroid || {})[today] || 0);
    const parkIds = new Set(todayLog.map((x) => x.parkId));
    if (park) parkIds.add(park.id);
    const visitedLands = new Set([...todayLog.map((x) => x.land), ...((saved.areas || {})[today] || [])].filter(Boolean));
    const allLands = new Set(data.parks.filter((p) => parkIds.has(p.id)).flatMap((p) => p.rides.map((r) => r.land)).filter((l) => l && l !== 'Other'));
    const snackList = Object.entries(snackCountsToday).map(([id, n]) => ({ name: allSnackNames[id] || 'Snack', n }));
    const mealList = Object.entries(mealsToday).map(([name, n]) => ({ name, n }));
    return {
      minutes, stepCount, stepsPartial: !(steps && steps.whole),
      dist: Math.round(stepCount * (R.metric || R.distKm ? STEP_KM : STEP_MILES) * 10) / 10, unit: R.metric || R.distKm ? 'km' : 'mi',
      rides: todayLog.length, queue: queueToday,
      areas: [...visitedLands].filter((l) => allLands.has(l)), areaTotal: allLands.size,
      missed: [...allLands].filter((l) => !visitedLands.has(l)),
      snacks: snackList, meals: mealList,
    };
  }, [data, now && now.minute, day, steps, saved, todayLog, park, R]);

  const shareRecap = () => {
    if (!recap) return;
    const lines = [`My ${R.short} Day`];
    if (recap.minutes) lines.push(`${fmtDuration(recap.minutes)} in the park`);
    if (recap.dist) lines.push(`${recap.dist} ${recap.unit} walked`);
    lines.push(`${recap.rides} ride${recap.rides === 1 ? '' : 's'} · ${fmtDuration(recap.queue)} queuing`);
    if (recap.areaTotal) lines.push(`${recap.areas.length} of ${recap.areaTotal} areas visited`);
    recap.meals.forEach((m) => lines.push(`${m.name} ×${m.n}`));
    recap.snacks.forEach((x) => lines.push(`${x.name} ×${x.n}`));
    lines.push('Planned with Ride Next');
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  // everything the Wrapped slides show
  const wrapData = (() => {
    if (!recap || !now || !data) return null;
    const counts = {};
    todayLog.forEach((x) => { counts[x.name] = (counts[x.name] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const timed = todayLog.filter((x) => x.wait > 0);
    const shortest = [...timed].sort((a, b) => a.wait - b.wait)[0];
    const longest = [...timed].sort((a, b) => b.wait - a.wait)[0];
    const srSaved = todayLog.reduce((a, x) => a + (x.srSaved || 0), 0);
    const snacks = [...recap.snacks].sort((a, b) => b.n - a.n);
    const snackTotal = snacks.reduce((a, x) => a + x.n, 0);
    const clock = (ms) => clockFromMs(ms, data.utcOffsetMinutes);
    const minuteOf = (ms) => Math.floor(((ms + data.utcOffsetMinutes * 60000) % 86400000 + 86400000) % 86400000 / 60000);

    // date label, e.g. SATURDAY 8 NOVEMBER
    const [, mm, dd] = now.dateKey.split('-').map(Number);
    const dateLabel = `${DAY_NAMES[now.dow]} ${dd} ${MONTH_NAMES[mm - 1]}`.toUpperCase();

    // queuing
    const q = recap.queue;
    const films = Math.round(q / 110);
    const queueLine = q === 0 ? 'No queues logged yet. Tap "Done" after each ride to fill this in.'
      : films >= 2 ? `That's ${films} whole films' worth of waiting.`
        : q >= 60 ? "That's a whole film's worth of waiting." : 'Hardly any queuing. Nicely played.';
    const queueChip = srSaved > 0 ? `But Single Rider saved you ${srSaved} min`
      : longest ? `Longest wait: ${longest.wait} min for ${longest.name}` : 'Ride Next keeps track as you go';

    // areas
    const missed = recap.missed || [];
    const areasLine = recap.areaTotal ? `${recap.areas.length} of ${recap.areaTotal} areas explored.` : 'Areas fill in as you ride.';
    const missedLine = !recap.areaTotal ? 'Turn on location to track where you wander.'
      : missed.length === 0 ? 'Every single area. Legend.' : `${missed[0]}, you're next time.`;

    // ride personality
    const first = todayLog[0], last = todayLog[todayLog.length - 1];
    const hrs = hoursFor(park).main[0];
    const opens = hrs ? toMin(hrs[0]) : null, closes = hrs ? toMin(hrs[1]) : null;
    let persona;
    if (todayLog.length >= 15) {
      persona = { title: 'The Ride Machine', short: 'Ride Machine', line: `${todayLog.length} rides in one day. Your stamina is unmatched.` };
    } else if (first && opens != null && minuteOf(first.at) >= opens - 60 && minuteOf(first.at) <= opens + 30) {
      const early = todayLog.filter((x) => minuteOf(x.at) >= opens - 60 && minuteOf(x.at) < opens + 120).length;
      persona = { title: 'The Rope Drop Warrior', short: 'Rope Drop Warrior', line: `First ride at ${clock(first.at)}. ${early} ride${early === 1 ? '' : 's'} before ${fmtHour(Math.floor(opens / 60) + 2)}.` };
    } else if (snackTotal >= 6) {
      persona = { title: 'The Snack Connoisseur', short: 'Snack Connoisseur', line: `${snackTotal} treats tried. A true professional.` };
    } else if (srSaved >= 30) {
      persona = { title: 'The Single Rider Pro', short: 'Single Rider Pro', line: `Single Rider saved you ${srSaved} minutes. Very smart.` };
    } else if (last && closes != null && closes > (opens || 0) && minuteOf(last.at) >= closes - 60) {
      persona = { title: 'The Night Owl', short: 'Night Owl', line: `Still riding at ${clock(last.at)}. You closed the park down.` };
    } else if (recap.areaTotal && missed.length === 0) {
      persona = { title: 'The Explorer', short: 'Explorer', line: 'You made it to every corner of the park.' };
    } else {
      persona = { title: 'The Happy Wanderer', short: 'Happy Wanderer', line: 'You took the day at your own pace. That\'s the magic.' };
    }

    // palette picked for you: Christmas in December, otherwise the land you spent most time in
    const landCount = {};
    todayLog.forEach((x) => { if (x.land) landCount[x.land] = (landCount[x.land] || 0) + 1; });
    const topLand = Object.entries(landCount).sort((a, b) => b[1] - a[1])[0];
    let autoId = R.key === 'dlp' ? 'parisian' : R.key === 'wdw' ? 'candlelit' : 'lakeside';
    let pickedLine = `Picked for you: your ${R.short} palette`;
    if (mm === 12) { autoId = 'christmas'; pickedLine = "Picked for you: it's Christmas time!"; }
    else if (topLand && LAND_PALETTE[topLand[0]]) { autoId = LAND_PALETTE[topLand[0]]; pickedLine = `Picked for you: most of your day was in ${topLand[0]}`; }
    const autoIdx = Math.max(0, WRAP_PALETTES.findIndex((p) => p.id === autoId));

    return {
      dateLabel, resortShort: R.short, autoIdx, pickedLine,
      openLine: todayLog.length ? "You went big today. Let's see just how big." : "Here's how your day is shaping up so far.",
      rides: todayLog.length, topRide: top ? { name: top[0], n: top[1] } : null,
      crowdLine: (() => {
        const lv = todayLog.map((x) => x.crowd).filter((x) => x);
        return lv.length ? `on a ${Math.round(lv.reduce((a, b) => a + b, 0) / lv.length)} out of 10 crowd day` : null;
      })(),
      shortestLine: shortest ? `Shortest wait of the day: ${shortest.wait} min, at ${clock(shortest.at)}` : 'Log rides to see your best waits',
      queueLabel: fmtDuration(q), queueLine, queueChip,
      dist: recap.dist || 0, distUnit: recap.unit, stepsLabel: recap.stepCount ? `${recap.stepCount.toLocaleString()} steps` : 'Steps count once your day starts',
      areasLine, missedLine,
      snacks, snackTotal, snackLine: snackTotal ? `${snackTotal} treat${snackTotal === 1 ? '' : 's'}. Zero regrets.` : 'Next time, treat yourself.',
      persona,
    };
  })();

  const captureSlide = () => captureRef(slideRef, { format: 'png', quality: 1, width: 1080, height: 1920, result: 'tmpfile' });
  const shareSlide = async () => {
    try {
      const uri = await captureSlide();
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Sharing isn\'t available on this device'); return; }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your day' });
    } catch (e) {
      Alert.alert('Couldn\'t make the image', 'Please try again.');
    }
  };
  const saveSlide = async () => {
    try {
      const uri = await captureSlide();
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) { Alert.alert('Photos access is off', 'Allow Ride Next to add photos in your phone settings, or use Share instead.'); return; }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'Your slide is in your photos.');
    } catch (e) {
      Alert.alert('Couldn\'t save here', 'Try Share to Stories instead. You can save from the share menu too.');
    }
  };
  const openWrapped = () => { setWrapSlide(0); setWrapPal(null); setScreen('wrapped'); };

  const resetPark = (p) => {
    setSaved((s) => ({
      ...s,
      selected: { ...s.selected, [p.id]: [] },
      done: Object.fromEntries(Object.entries(s.done).filter(([k]) => !k.endsWith(`:${p.id}`))),
      log: Object.fromEntries(Object.entries(s.log || {}).map(([d, list]) => [d, list.filter((x) => x.parkId !== p.id)])),
    }));
    setSkippedBy((k) => ({ ...k, [p.id]: [] }));
  };
  // Alert buttons do nothing on web (Snack's Web preview), so use the browser's confirm there
  const askConfirm = (title, body, okText, onOk) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) onOk();
      return;
    }
    Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: okText, style: 'destructive', onPress: onOk }]);
  };
  const confirmReset = (p) => askConfirm(
    `Reset ${p.name}?`,
    'This clears the rides you picked and what you\'ve ridden today in this park.',
    'Reset', () => resetPark(p),
  );
  // clears everything logged today in every park; settings, ratings and your own snacks stay
  const resetDay = () => {
    setSaved((cur) => ({
      ...cur,
      selected: {}, done: {}, queue: null, day: null,
      log: Object.fromEntries(Object.entries(cur.log || {}).filter(([d]) => d !== today)),
      snackCounts: {}, meals: {}, areas: {}, stepsAndroid: {},
    }));
    setSkippedBy({});
  };
  const confirmResetDay = () => askConfirm(
    'Reset your whole day?',
    'This clears today\'s picked and ridden rides, snacks, meals, areas and Day Recap in every park. Your settings and ratings stay.',
    'Reset day', resetDay,
  );

  const toggleRide = (id) => setSaved((s) => {
    const cur = s.selected[park.id] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { ...s, selected: { ...s.selected, [park.id]: next } };
  });
  const markDone = (ride, actual = null) => setSaved((s) => {
    // keep only today's done lists so storage stays small
    const key = `${now.dateKey}:${ride.parkId || park.id}`;
    const keep = Object.fromEntries(Object.entries(s.done).filter(([k]) => k.startsWith(now.dateKey)));
    const postedWait = ride.posted ? ride.wait : 0;
    const log = { [now.dateKey]: [...((s.log || {})[now.dateKey] || []),
      { id: ride.id, name: ride.name, parkId: ride.parkId, land: ride.land, wait: actual != null ? actual : postedWait, posted: postedWait,
        actual, at: Date.now(),
        srSaved: ride.viaSingle ? Math.max(0, ride.standby - (actual != null ? actual : ride.wait)) : 0,
        crowd: (crowdFor(data.parks.find((p) => p.id === (ride.parkId || park.id))) || {}).level || null }] };
    return { ...s, done: { ...keep, [key]: [...(keep[key] || []), ride.id] }, log };
  });

  // queue timer: "I'm in the queue" starts it, "On the ride!" stops it and logs the real wait
  const startQueue = (ride) => setSaved((cur) => ({ ...cur, queue: {
    id: ride.id, name: ride.name, parkId: ride.parkId || park.id, land: ride.land, posted: ride.posted ? ride.wait : 0,
    viaSingle: !!ride.viaSingle, standby: ride.standby != null ? ride.standby : ride.wait, start: Date.now() } }));
  const cancelQueue = () => setSaved((cur) => ({ ...cur, queue: null }));
  const finishQueue = () => {
    const q = saved.queue;
    if (!q) return;
    const actual = Math.max(1, Math.round((Date.now() - q.start) / 60000));
    markDone({ id: q.id, name: q.name, parkId: q.parkId, land: q.land, posted: q.posted > 0, wait: q.posted, viaSingle: q.viaSingle, standby: q.standby }, actual);
    if (actual <= 240) {
      const t = parkNow(data.utcOffsetMinutes);
      queueEvent({ type: 'wait', parkId: q.parkId, rideId: q.id, posted: q.posted, actual, singleRider: q.viaSingle, dow: t.dow, hour: t.hour });
    }
    cancelQueue();
  };
  const queueMinutes = saved.queue ? Math.max(0, Math.round((Date.now() - saved.queue.start) / 60000)) : 0;
  const queueCard = saved.queue ? (
    <View style={[s.card, { backgroundColor: C.dark, borderColor: C.dark }]}>
      <Text style={[s.kicker, { color: C.accentSoft }]}>In the queue</Text>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{saved.queue.name}</Text>
      <Text style={{ color: '#CBD5E1', fontSize: 15 }}>
        {queueMinutes} min so far{saved.queue.posted ? ` · posted wait was ${saved.queue.posted} min` : ''}
      </Text>
      <View style={s.row}>
        <Pressable style={[s.btnLight, { flex: 1 }]} onPress={finishQueue} accessibilityRole="button">
          <Text style={s.btnLightText}>On the ride!</Text>
        </Pressable>
        <Pressable style={s.btnOutlineDark} onPress={cancelQueue} accessibilityRole="button">
          <Text style={s.btnOutlineDarkText}>Left the queue</Text>
        </Pressable>
      </View>
      {queueMinutes > 240 ? <Text style={{ color: '#FCA5A5', fontSize: 13 }}>Still in this queue? It's been over 4 hours, so this one won't count towards guests' waits.</Text> : null}
    </View>
  ) : null;

  const toggleWatch = async (id) => {
    const on = (saved.watch || []).includes(id);
    if (!on) await askNotifyPermission();
    setSaved((cur) => ({ ...cur, watch: on ? cur.watch.filter((x) => x !== id) : [...(cur.watch || []), id] }));
  };

  // "Remind me when it opens": rides on your list that break down are on automatically, anything else you ask for
  const remindOn = (id, status) => (saved.watch || []).includes(id)
    || (status === 'DOWN' && onMyList(id) && !(saved.noRemind || []).includes(id));
  const toggleRemind = async (id, status) => {
    if (remindOn(id, status)) {
      setSaved((cur) => ({ ...cur, watch: (cur.watch || []).filter((x) => x !== id),
        noRemind: status === 'DOWN' && onMyList(id) ? [...(cur.noRemind || []), id] : (cur.noRemind || []) }));
      return;
    }
    await askNotifyPermission();
    setSaved((cur) => ({ ...cur, watch: [...(cur.watch || []).filter((x) => x !== id), id],
      noRemind: (cur.noRemind || []).filter((x) => x !== id) }));
  };

  const toggleReminder = async (key, startIso, name) => {
    const existing = (saved.reminders || {})[key];
    if (existing) {
      await cancelNotify(existing);
      setSaved((cur) => { const r = { ...cur.reminders }; delete r[key]; return { ...cur, reminders: r }; });
      return;
    }
    if (!(await askNotifyPermission())) {
      Alert.alert('Notifications are off', 'Turn on notifications for Expo Go / Ride Next in your phone settings to get reminders.');
      return;
    }
    const lead = BIG_SHOW.test(name) ? 45 : 20;
    const at = new Date(Date.parse(startIso) - lead * 60000);
    if (at.getTime() < Date.now()) { Alert.alert('Starting soon', `${name} starts in less than ${lead} minutes, so head over now!`); return; }
    const id = await notifyAt(at, `${name} in ${lead} minutes`,
      BIG_SHOW.test(name) ? 'Start heading over now to get a good spot.' : 'Time to start heading over.');
    if (id) setSaved((cur) => ({ ...cur, reminders: { ...(cur.reminders || {}), [key]: id } }));
  };

  const setWaitAlert = async (id, target) => {
    if (target != null && !(await askNotifyPermission())) {
      Alert.alert('Notifications are off', 'We\'ll still show an alert in the app, but turn on notifications to get a buzz.');
    }
    setSaved((cur) => {
      const next = { ...(cur.waitAlerts || {}) };
      if (target == null) delete next[id]; else next[id] = target;
      return { ...cur, waitAlerts: next };
    });
  };
  const rateMeal = (name, stars) => {
    setSaved((cur) => ({ ...cur, ratings: { ...(cur.ratings || {}), [name]: stars } }));
    queueEvent({ type: 'rating', place: name, stars });
  };
  const openRecap = (from) => { setBackTo(from); setScreen('recap'); };

  const bookedMulti = async (ride) => {
    await askNotifyPermission();
    const bookedAt = Date.now();
    const notifId = await notifyAt(new Date(bookedAt + MULTI_PASS_GAP_MIN * 60000), 'Book your next Lightning Lane',
      'It has been 2 hours since your last Multi Pass booking, so you can book another now.');
    setSaved((cur) => ({ ...cur, ll: { dateKey: now.dateKey, rideId: ride.id, rideName: ride.name, bookedAt, used: false, notifId } }));
  };
  const usedMulti = () => {
    if (saved.ll) cancelNotify(saved.ll.notifId);
    setSaved((cur) => ({ ...cur, ll: cur.ll ? { ...cur.ll, used: true } : null }));
  };

  // ---------- ranking ----------
  const plan = useMemo(() => {
    if (!park || !now) return null;
    const parks = saved.hopper ? data.parks : [park];
    const rides = parks.flatMap((p) => p.rides.filter((r) => (saved.selected[p.id] || []).includes(r.id)))
      .filter((r) => !tooTall(r));
    const allSkipped = parks.flatMap((p) => skippedBy[p.id] || []);
    const ranked = [], down = [];
    rides.forEach((r) => {
      const l = live[r.id] || {};
      if (doneFor(r.parkId).includes(r.id)) return;
      if (l.status && l.status !== 'OPERATING') { down.push({ ...r, status: l.status }); return; }
      const standby = l.wait != null ? l.wait : 5;
      const useSR = saved.useSingle && l.singleRider != null && l.singleRider < standby;
      const wait = useSR ? l.singleRider : standby;
      const look = outlook(r, now, l.wait, closeHourFor(r.parkId));
      const walk = saved.useLoc ? walkMinutes(coords, r.loc) : null;
      const otherPark = r.parkId !== park.id;
      const fw = l.wait != null && !useSR ? fanWait(r.id, wait) : null; // fans' real standby waits beat the posted number
      let score = (fw ? fw.est : wait) + (walk || 0) + (otherPark && walk == null ? R.hopMin : 0);
      if (look.trend === 'up') score -= Math.min(15, Math.round(look.diff / 2));
      if (look.trend === 'down') score += Math.min(20, Math.round(-look.diff / 2));
      if (saved.rain && !r.indoor) score += 30;
      ranked.push({
        ...r, wait, standby, viaSingle: useSR, singleRider: l.singleRider, posted: l.wait != null,
        look, walk, otherPark, hop: otherPark ? R.hopMin : 0, score, multi: l.multi, multiReturn: l.multiReturn,
      });
    });
    ranked.sort((a, b) => {
      const sa = allSkipped.indexOf(a.id), sb = allSkipped.indexOf(b.id);
      if (sa !== sb) { if (sa === -1) return -1; if (sb === -1) return 1; return sa - sb; }
      return a.score - b.score;
    });
    const parkClosed = rides.length > 0 && down.length === rides.length && down.every((d) => d.status === 'CLOSED');
    return { ranked, down, parkClosed };
  }, [park, data, now && now.hour, live, saved, skippedBy, coords, fans]);

  // ---------- render ----------
  if (!storeReady || !introDone) {
    return <LoadingScreen />;
  }

  if (saved.resort && screen === 'location') {
    const turnOn = async () => {
      let status = 'denied';
      try { ({ status } = await Location.requestForegroundPermissionsAsync()); } catch (e) { /* ignore */ }
      setSaved((cur) => ({ ...cur, locAsked: true, useLoc: status === 'granted' }));
      if (status !== 'granted') {
        Alert.alert('Location is off', 'Ride Next still works, just without walking times. You can turn it on any time in Settings.',
          [{ text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) }, { text: 'OK' }]);
      }
      setScreen('welcome');
    };
    const later = () => { setSaved((cur) => ({ ...cur, locAsked: true })); setScreen('welcome'); };
    const perks = [
      ['pin', 'Closest rides first', 'Walking time from where you are, so you never cross the park for nothing.'],
      ['map', 'Areas you explored', 'Your Day Recap and Wrapped fill in the lands you visited.'],
      ['food', 'Food nearby', 'Quick bites sorted by how close they are.'],
    ];
    return (
      <SafeAreaView style={s.welcome}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={s.welcomeInner}>
          <View style={{ gap: 10 }}>
            <Text style={s.welcomeKicker}>ONE QUICK THING</Text>
            <Text style={s.welcomeTitle}>Ride Next works best with your location</Text>
            <Text style={s.welcomeTag}>We only use it while the app is open, and it never leaves your phone.</Text>
          </View>
          <View style={{ gap: 12 }}>
            {perks.map(([icon, title, body]) => (
              <View key={title} style={[s.parkCard, { flexDirection: 'row', gap: 14, alignItems: 'center' }]}>
                <IconBadge name={icon} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.parkCardMeta, { color: C.ink, fontWeight: '700', fontSize: 16 }]}>{title}</Text>
                  <Text style={s.parkCardMeta}>{body}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ gap: 10 }}>
            <Pressable style={[s.btnLight, { minHeight: 52 }]} onPress={turnOn} accessibilityRole="button">
              <Text style={s.btnLightText}>Turn on location</Text>
            </Pressable>
            <Pressable onPress={later} accessibilityRole="button" style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: '#CBD5E1', fontSize: 15, fontWeight: '600' }}>Not now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!saved.resort || screen === 'city') {
    const chooseResort = (key) => {
      setSaved((cur) => ({ ...cur, resort: key }));
      setParkIdx(0);
      setScreen(saved.locAsked ? 'welcome' : 'location');
    };
    return (
      <SafeAreaView style={s.welcome}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={s.welcomeInner}>
          <View style={{ gap: 10 }}>
            <Text style={s.welcomeTitle}>Ride Next</Text>
            <Text style={s.welcomeTag}>Less queuing, more riding.</Text>
          </View>
          <View style={{ gap: 12 }}>
            <Text style={s.welcomeKicker}>WHERE ARE YOU VISITING?</Text>
            {Object.values(RESORTS).map((x) => {
              const on = saved.resort === x.key;
              return (
                <Pressable key={x.key} style={[s.parkCard, on && { borderWidth: 3, borderColor: C.accentSoft }]} onPress={() => chooseResort(x.key)}
                  accessibilityRole="button" accessibilityLabel={`${x.city}, ${x.name}`} accessibilityState={{ selected: on }}>
                  <View style={s.rowBetween}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.cityName}>{x.city}</Text>
                      <Text style={s.parkCardMeta}>{x.country}</Text>
                    </View>
                    <Text style={s.parkCardArrow}>›</Text>
                  </View>
                  <Text style={[s.parkCardMeta, { color: C.ink, fontWeight: '700' }]}>{x.name}</Text>
                  <Text style={s.parkCardMeta}>{x.parks}</Text>
                </Pressable>
              );
            })}
            {saved.resort ? (
              <Pressable style={s.ghostBtnDark} onPress={() => setScreen('welcome')} accessibilityRole="button">
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Cancel</Text>
              </Pressable>
            ) : null}
            <Text style={s.welcomeSmall}>You can change this any time from the home screen.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'welcome') {
    const ready = !!data;
    const anyToday = ready && (todayLog.length > 0 || !!day);
    return (
      <SafeAreaView style={s.welcome}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={s.welcomeInner}>
          <View style={{ gap: 10 }}>
            <View style={s.rowBetween}>
              <Text style={s.welcomeKicker}>{R.name.toUpperCase()} · {R.city.toUpperCase()}</Text>
              <Pressable onPress={() => setScreen('city')} accessibilityRole="button" accessibilityLabel="Change where you're visiting"
                style={s.changeBtn}>
                <Text style={s.changeBtnText}>Change</Text>
              </Pressable>
            </View>
            <Text style={s.welcomeTitle}>Ride Next</Text>
            <Text style={s.welcomeTag}>Less queuing, more riding.</Text>
          </View>

          <View style={{ gap: 14 }}>
            {[
              ['1', 'Pick your rides', 'Tick everything you want to do today.'],
              ['2', 'We tell you what to ride next', 'Live waits, Single Rider, walking time, and whether to ride now or come back at a quieter time.'],
              ['3', 'Snacks, shows and your Day Recap', 'Track every churro, get show reminders, and share your day.'],
            ].map(([n, title, body]) => (
              <View key={n} style={s.stepRow}>
                <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{title}</Text>
                  <Text style={s.stepBody}>{body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: 12 }}>
            <Text style={s.welcomeKicker}>CHOOSE YOUR PARK</Text>
            {error && !ready ? <Text style={[s.errorText, { color: '#FCA5A5' }]}>{error}</Text> : null}
            {!ready ? (
              <View style={s.parkCard}><ActivityIndicator color={C.ink} /><Text style={s.parkCardMeta}>Loading park data…</Text></View>
            ) : data.parks.map((p, i) => {
              const picked = (saved.selected[p.id] || []).length;
              const doneToday = (saved.done[`${parkNow(data.utcOffsetMinutes).dateKey}:${p.id}`] || []).length;
              return (
                <View key={p.id} style={s.parkCard}>
                  <Pressable onPress={() => { setParkIdx(i); setScreen(picked > 0 ? 'next' : 'setup'); }}
                    accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} style={{ gap: 4 }}>
                    <View style={s.rowBetween}>
                      <Text style={s.parkCardTitle}>{p.name}</Text>
                      <Text style={s.parkCardArrow}>›</Text>
                    </View>
                    <Text style={[s.parkCardMeta, { color: C.ink, fontWeight: '600' }]}>{hoursLine(p)}</Text>
                    {crowdFor(p) ? <CrowdMeter c={crowdFor(p)} compact /> : null}
                    {hoursFor(p).extras.map((x, k) => (
                      <Text key={k} style={s.parkCardMeta}>{x.label}: {fmtRange(x.range)}</Text>
                    ))}
                    <Text style={s.parkCardMeta}>
                      {picked > 0 ? `${picked} ride${picked === 1 ? '' : 's'} picked · ${doneToday} done today` : 'Not started yet'}
                    </Text>
                  </Pressable>
                  {picked > 0 || doneToday > 0 ? (
                    <Pressable onPress={() => confirmReset(p)} accessibilityRole="button"
                      accessibilityLabel={`Reset ${p.name}`} style={s.resetBtn}>
                      <Text style={s.resetBtnText}>Reset this park</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            {anyToday ? (
              <Pressable style={s.recapLink} onPress={() => openRecap('welcome')} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={s.recapLinkTitle}>Today's Day Recap</Text>
                  <Text style={s.recapLinkMeta}>{todayLog.length} ride{todayLog.length === 1 ? '' : 's'} so far · tap to see and share</Text>
                </View>
                <Text style={s.recapLinkTitle}>›</Text>
              </Pressable>
            ) : null}
            {anyToday || Object.values(saved.selected || {}).some((l) => l && l.length) ? (
              <Pressable onPress={confirmResetDay} accessibilityRole="button"
                accessibilityLabel="Reset my whole day" style={[s.resetBtn, { alignSelf: 'center' }]}>
                <Text style={s.resetBtnText}>Reset my day</Text>
              </Pressable>
            ) : null}
            <Text style={s.welcomeSmall}>Unofficial app. Not affiliated with or endorsed by Disney. Wait times are estimates.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!data) {
    return <LoadingScreen message={error || 'Checking live waits'} />;
  }

  const updatedText = updatedAt ? `Updated ${minutesAgo(updatedAt)}` : 'Loading live waits…';
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onPull} />;
  const findRide = (id) => {
    for (let i = 0; i < data.parks.length; i++) {
      const r = data.parks[i].rides.find((x) => x.id === id);
      if (r) return r;
    }
    return null;
  };
  const openRide = (id) => { setDetailId(id); setScreen('detail'); };
  const alertFor = (id) => (saved.waitAlerts || {})[id];
  const onMyList = (id) => Object.values(saved.selected || {}).some((list) => (list || []).includes(id));
  const bannerView = banner ? (
    <Pressable style={s.banner} onPress={() => setBanner(null)} accessibilityRole="button" accessibilityLabel="Dismiss alert">
      <Text style={s.bannerText}>{banner}</Text>
      <Text style={s.bannerClose}>Tap to dismiss</Text>
    </Pressable>
  ) : null;

  // rope drop: before opening, the first 45 minutes, or tonight for tomorrow
  const ropeDropFor = (p) => {
    const sel = saved.selected[p.id] || [];
    const todayHours = hoursFor(p).main[0];
    const opensMin = todayHours ? toMin(todayHours[0]) : null;
    const closesMin = todayHours ? toMin(todayHours[1]) : null;
    let rd = null;
    const pool = (sel.length ? p.rides.filter((r) => sel.includes(r.id)) : p.rides).filter((r) => !tooTall(r));
    if (opensMin != null && now.minute < opensMin + 45 && !(closesMin != null && closesMin < opensMin && now.minute < closesMin)) {
      rd = { when: now.minute < opensMin ? 'today' : 'now', open: todayHours[0] };
    } else {
      const tomorrow = hoursFor(p, nextDateKey(now.dateKey)).main[0];
      const afterClose = !todayHours || (closesMin != null && closesMin > opensMin && now.minute >= closesMin);
      if (tomorrow && afterClose) rd = { when: 'tomorrow', open: tomorrow[0] };
    }
    if (!rd) return null;
    const openHour = Math.floor(toMin(rd.open) / 60);
    rd.picks = ropeDropPicks(pool, openHour, `${R.key}:${p.name}`);
    rd.by = fmtHour(openHour + 2);
    rd.fromList = sel.length > 0;
    return rd.picks.length ? rd : null;
  };
  const ropeDropCard = (p) => {
    const ropeDrop = ropeDropFor(p);
    if (!ropeDrop) return null;
    return (
      <View style={[s.card, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
        <Text style={s.kicker}>Rope drop plan{ropeDrop.when === 'tomorrow' ? ' for tomorrow' : ''}</Text>
        <Text style={s.body}>
          {ropeDrop.when === 'now' ? 'The park just opened. ' : `Opens ${fmtTime(ropeDrop.open)}${ropeDrop.when === 'tomorrow' ? ' tomorrow' : ''}. `}
          Head to {ropeDrop.picks[0].name} first
          {ropeDrop.picks[1] ? `, then ${ropeDrop.picks[1].name}` : ''}
          {ropeDrop.picks[2] ? `, then ${ropeDrop.picks[2].name}` : ''} before {ropeDrop.by}.
        </Text>
        <Text style={s.mutedSmall}>
          {ropeDrop.fromList ? 'From the rides you picked: these' : 'These'} lines grow fastest after opening, so they're worth doing first.
        </Text>
      </View>
    );
  };

  // ----- Day Wrapped -----
  if (screen === 'wrapped' && wrapData) {
    const d = wrapData;
    const N = WRAP_PALETTES.length;
    const pi = wrapPal == null ? d.autoIdx : wrapPal;
    const P = WRAP_PALETTES[pi];
    const key = WRAP_SLIDES[wrapSlide];
    const Slide = WRAP_COMPONENTS[key];
    const slideW = Math.max(220, Math.min(winW - 40, (winH - 330) * 9 / 16));
    const k = slideW / 360;
    // two invisible halves over the slide: tap left = back, tap right = next, swipe sideways = new colours
    const onDown = (e) => { touchRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; };
    const onUp = (side) => (e) => {
      const t = touchRef.current;
      touchRef.current = null;
      const dx = t ? e.nativeEvent.pageX - t.x : 0, dy = t ? e.nativeEvent.pageY - t.y : 0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { setWrapPal((pi + (dx < 0 ? 1 : -1) + N) % N); return; }
      setWrapSlide((sIdx) => (side === 'back' ? Math.max(0, sIdx - 1) : Math.min(WRAP_SLIDES.length - 1, sIdx + 1)));
    };
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar style="light" />
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 4, width: slideW }}>
            {WRAP_SLIDES.map((x, i) => (
              <View key={x} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= wrapSlide ? '#fff' : '#475569' }} />
            ))}
          </View>
          <View style={{ width: slideW, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#CBD5E1', fontSize: 13 }}>{wrapSlide + 1} of {WRAP_SLIDES.length} · tap the sides to move</Text>
            <Pressable onPress={() => setScreen('recap')} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>

          <View style={{ width: slideW, height: slideW * 16 / 9, borderRadius: 16, overflow: 'hidden' }}
            accessibilityLabel={`Slide ${wrapSlide + 1} of ${WRAP_SLIDES.length}, ${P.name} colours`}>
            <View ref={slideRef} collapsable={false} style={{ width: slideW, height: slideW * 16 / 9 }}>
              <Slide k={k} c={P[key]} d={d} />
            </View>
            <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
              <Pressable style={{ flex: 1 }} onPressIn={onDown} onPressOut={onUp('back')}
                accessibilityRole="button" accessibilityLabel="Previous slide" />
              <Pressable style={{ flex: 1 }} onPressIn={onDown} onPressOut={onUp('next')}
                accessibilityRole="button" accessibilityLabel="Next slide" />
            </View>
          </View>

          <View style={{ width: slideW, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => setWrapPal((pi - 1 + N) % N)} accessibilityRole="button" accessibilityLabel="Previous colours" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 26 }}>‹</Text>
            </Pressable>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ color: '#CBD5E1', fontSize: 14 }}>Swipe to change colours · <Text style={{ color: '#fff', fontWeight: '800' }}>{P.name}</Text></Text>
              {pi === d.autoIdx ? <Text style={{ color: '#FDE68A', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{d.pickedLine}</Text> : null}
            </View>
            <Pressable onPress={() => setWrapPal((pi + 1) % N)} accessibilityRole="button" accessibilityLabel="Next colours" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 26 }}>›</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, width: slideW }} contentContainerStyle={{ gap: 8 }}>
            {WRAP_PALETTES.map((p, i) => (
              <Pressable key={p.id} onPress={() => setWrapPal(i)} accessibilityRole="button" accessibilityLabel={`${p.name} colours`}
                accessibilityState={{ selected: i === pi }}
                style={{ width: 64, paddingVertical: 6, alignItems: 'center', gap: 4, borderRadius: 12, borderWidth: 2, borderColor: i === pi ? '#fff' : '#334155' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' }}>
                  {p.sw.map((col, j) => <View key={j} style={{ width: 13, height: 13, backgroundColor: col }} />)}
                </View>
                <Text numberOfLines={1} style={{ color: '#E2E8F0', fontSize: 11, fontWeight: '600' }}>{p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ width: slideW, gap: 8, marginTop: 'auto' }}>
            <Pressable onPress={shareSlide} accessibilityRole="button" style={{ minHeight: 52, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#000', fontSize: 17, fontWeight: '800' }}>Share to Stories</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={saveSlide} accessibilityRole="button" style={{ flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: '#475569', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Save image</Text>
              </Pressable>
              <Pressable onPress={shareRecap} accessibilityRole="button" style={{ flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: '#475569', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Share as text</Text>
              </Pressable>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>Shares this slide. In the share menu, pick Instagram, then Story.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ----- Day Recap -----
  if (screen === 'recap') {
    const rideGroups = [];
    todayLog.forEach((x) => {
      const g = rideGroups.find((y) => y.id === x.id);
      if (g) { g.n += 1; g.wait += x.wait || 0; } else rideGroups.push({ id: x.id, name: x.name, parkId: x.parkId, land: x.land, n: 1, wait: x.wait || 0 });
    });
    const snackGroups = Object.entries(snackCountsToday).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n, name: allSnackNames[id] || 'Snack' }));
    const q = norm(recapQuery).toLowerCase();
    const match = (name) => !q || name.toLowerCase().includes(q);
    const rideChoices = data.parks.flatMap((p) => p.rides.map((x) => ({ ...x, parkId: p.id, label: x.name, sub: `${shortPark(p.name)} · ${x.land}` })))
      .filter((x) => match(x.name)).slice(0, 8);
    const mealChoices = data.parks.flatMap((p) => (p.food || []).filter((f) => f.service !== 'snack')
      .map((f) => ({ ...f, label: f.name, sub: shortPark(p.name) }))).filter((x) => match(x.name)).slice(0, 8);
    const snackSeen = new Set();
    const parkOrder = [park, ...data.parks.filter((p) => p.id !== park.id)];
    const snackChoices = [...(saved.customSnacks || []), ...parkOrder.flatMap((p) => SNACKS[`${R.key}:${p.name}`] || [])]
      .filter((x) => (snackSeen.has(x.id) ? false : snackSeen.add(x.id)))
      .map((x) => ({ ...x, label: x.name, sub: x.where || 'Your own' }));
    const addPanel = (kind, title, placeholder, choices, onPick) => (recapAdd !== kind ? (
      <Pressable onPress={() => { setRecapAdd(kind); setRecapQuery(''); }} accessibilityRole="button"
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: C.blue, fontSize: 22, fontWeight: '700', lineHeight: 24 }}>+</Text>
        <Text style={{ color: C.blue, fontSize: 15, fontWeight: '700' }}>{title}</Text>
      </Pressable>
    ) : (
      <View style={{ gap: 6, marginTop: 6 }}>
        <TextInput value={recapQuery} onChangeText={setRecapQuery} placeholder={placeholder} autoFocus
          style={{ minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: C.ink }} />
        {choices.length ? choices.map((x) => (
          <Pressable key={x.id} onPress={() => onPick(x)} accessibilityRole="button" accessibilityLabel={`Add ${x.label}`}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.body}>{x.label}</Text>
              {x.sub ? <Text style={s.mutedSmall}>{x.sub}</Text> : null}
            </View>
            <Text style={{ color: C.blue, fontSize: 15, fontWeight: '700' }}>Add</Text>
          </Pressable>
        )) : <Text style={s.mutedSmall}>Nothing matches "{recapQuery}".</Text>}
        <Pressable onPress={() => { setRecapAdd(null); setRecapQuery(''); }} accessibilityRole="button"
          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.muted, fontSize: 15, fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>
    ));
    const r = recap;
    const ended = day && day.end;
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.topBar}>
          <Pressable style={s.ghostBtn} onPress={() => setScreen(backTo)} accessibilityRole="button">
            <Text style={s.ghostBtnText}>‹ Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.pad}>
          <View style={s.hero}>
            <Text style={s.heroKicker}>MY {R.short.toUpperCase()} DAY · {DAY_NAMES[now.dow].toUpperCase()}</Text>
            <View style={s.recapGrid}>
              <Stat label="In the park" value={r.minutes ? fmtDuration(r.minutes) : '—'} />
              <Stat label="Walked" value={r.dist ? `${r.dist} ${r.unit}` : '—'} />
              <Stat label="Rides" value={String(r.rides)} />
              <Stat label="Queuing" value={fmtDuration(r.queue)} />
            </View>
            {r.areaTotal ? (
              <Text style={s.heroBody}>{r.areas.length} of {r.areaTotal} areas visited{r.missed.length && r.missed.length <= 3 ? `. You missed ${r.missed.join(', ')}!` : ''}</Text>
            ) : null}
            <Pressable style={s.btnLight} onPress={openWrapped} accessibilityRole="button">
              <Text style={s.btnLightText}>See my Day Wrapped</Text>
            </Pressable>
            <Pressable onPress={shareRecap} accessibilityRole="button" style={{ alignSelf: 'center', minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: '#CBD5E1', fontSize: 14, fontWeight: '600' }}>Or share as text</Text>
            </Pressable>
          </View>

          {!day ? (
            <View style={s.card}>
              <Text style={s.h3}>Start tracking your day</Text>
              <Text style={s.muted}>Time in the park and steps start counting when you start your day.</Text>
              <Pressable style={s.btnDark} onPress={startDay} accessibilityRole="button"><Text style={s.btnDarkText}>Start my day</Text></Pressable>
            </View>
          ) : (
            <Text style={s.mutedSmall}>
              {`Started ${clockFromMs(day.start, data.utcOffsetMinutes)}`}
              {ended ? ` · ended ${clockFromMs(day.end, data.utcOffsetMinutes)}` : ''}
              {r.stepCount ? ` · ${r.stepCount.toLocaleString()} steps` : ''}
              {r.stepsPartial && r.dist ? ' · on Android, steps only count while the app is open' : ''}
            </Text>
          )}

          <View style={s.card}>
            <Text style={s.h3}>Rides · {todayLog.length}</Text>
            {rideGroups.length ? rideGroups.map((g) => (
              <View key={g.id} style={s.listLine}>
                <View style={{ flex: 1 }}>
                  <Text style={s.body}>{g.name}</Text>
                  {g.wait ? <Text style={s.mutedSmall}>{fmtDuration(g.wait)} queuing</Text> : null}
                </View>
                <Counter n={g.n} label={g.name} onMinus={() => removeRideLog(g.id)} onPlus={() => addRideLog(g)} />
              </View>
            )) : <Text style={s.muted}>No rides logged yet. Tap "Done, ridden it" on Ride next, or add them here.</Text>}
            {addPanel('ride', 'Add a ride', 'Search rides', rideChoices, (x) => addRideLog(x))}
          </View>

          <View style={s.card}>
            <Text style={s.h3}>Areas visited · {r.areas.length}{r.areaTotal ? ` of ${r.areaTotal}` : ''}</Text>
            {r.areas.length ? (
              <View style={s.chips}>
                {r.areas.map((a) => <View key={a} style={s.tag}><Text style={s.tagText}>{a}</Text></View>)}
              </View>
            ) : <Text style={s.muted}>Areas fill in as you ride, or as you walk around with location turned on.</Text>}
            {r.areas.length && r.missed.length ? <Text style={s.mutedSmall}>Not visited yet: {r.missed.join(', ')}</Text> : null}
          </View>

          <View style={s.card}>
            <Text style={s.h3}>Where you ate · {r.meals.reduce((a, m) => a + m.n, 0)}</Text>
            {r.meals.length ? r.meals.map((m) => (
              <View key={m.name} style={s.listLine}>
                <View style={{ flex: 1 }}>
                  <Text style={s.body}>{m.name}</Text>
                  {(saved.ratings || {})[m.name] ? <Text style={s.mutedSmall}>{'★'.repeat(saved.ratings[m.name])}</Text> : null}
                </View>
                <Counter n={m.n} label={m.name} onMinus={() => bumpMeal(m.name, -1)} onPlus={() => bumpMeal(m.name, 1)} />
              </View>
            )) : <Text style={s.muted}>Tap "I ate here" in Hungry? on Ride next, or add a restaurant here.</Text>}
            {addPanel('meal', 'Add a restaurant', 'Search restaurants', mealChoices, (x) => bumpMeal(x.name, 1))}
          </View>

          <View style={s.card}>
            <Text style={s.h3}>Snacks · {r.snacks.reduce((a, x) => a + x.n, 0)}</Text>
            {snackGroups.length ? snackGroups.map((x) => (
              <View key={x.id} style={s.listLine}>
                <Text style={[s.body, { flex: 1 }]}>{x.name}</Text>
                <Counter n={x.n} label={x.name} onMinus={() => bumpSnack(x.id, -1)} onPlus={() => bumpSnack(x.id, 1)} />
              </View>
            )) : <Text style={s.muted}>Use the Snack tracker on Ride next, or add a treat here.</Text>}
            {recapAdd !== 'snack' ? (
              <Pressable onPress={() => { setRecapAdd('snack'); setRecapQuery(''); }} accessibilityRole="button"
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: C.blue, fontSize: 22, fontWeight: '700', lineHeight: 24 }}>+</Text>
                <Text style={{ color: C.blue, fontSize: 15, fontWeight: '700' }}>Open snack tracker</Text>
              </Pressable>
            ) : (
              <View style={{ gap: 2, marginTop: 6 }}>
                <Text style={s.kicker}>Popular in the park</Text>
                {snackChoices.map((x) => (
                  <View key={x.id} style={s.listLine}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.body}>{x.name}</Text>
                      <Text style={s.mutedSmall}>{x.sub}</Text>
                    </View>
                    <Counter n={snackCountsToday[x.id] || 0} label={x.name} onMinus={() => bumpSnack(x.id, -1)} onPlus={() => bumpSnack(x.id, 1)} />
                  </View>
                ))}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TextInput value={newSnack} onChangeText={setNewSnack} placeholder="Add your own, e.g. Pumpkin churro"
                    onSubmitEditing={() => addCustomSnack(newSnack)} returnKeyType="done"
                    style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: C.ink }} />
                  <Pressable onPress={() => addCustomSnack(newSnack)} accessibilityRole="button" style={[s.smallBtn, { minHeight: 44 }]}>
                    <Text style={s.smallBtnText}>Add</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setRecapAdd(null)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.muted, fontSize: 15, fontWeight: '700' }}>Done</Text>
                </Pressable>
              </View>
            )}
          </View>

          {day && !ended ? (
            <Pressable style={s.ghostBtnWide} onPress={endDay} accessibilityRole="button">
              <Text style={s.ghostBtnText}>End my day</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ----- Ride detail -----
  if (screen === 'detail') {
    const ride = findRide(detailId) || park.rides[0];
    const l = live[ride.id] || {};
    const look = outlook(ride, now, l.wait, closeHourFor(ride.parkId));
    const typ = typicalFor(ride, now.dow, now.dayType);
    // every hour the park is open today, with "no data yet" for hours the logger hasn't covered
    const rideParkObj = data.parks.find((p) => p.id === ride.parkId) || park;
    const openRange = (hoursFor(rideParkObj).main || [])[0];
    let hourList = [];
    if (openRange) {
      const o = Math.floor(toMin(openRange[0]) / 60);
      let c = Math.ceil(toMin(openRange[1]) / 60);
      if (c <= o) c += 24; // closes after midnight
      for (let h = o; h < c; h++) hourList.push(h % 24);
    }
    if (typ) typ.forEach((v, h) => { if (v != null && !hourList.includes(h)) hourList.push(h); });
    if (!openRange) hourList.sort((a, b) => a - b);
    const hours = hourList.map((h) => ({ h, v: typ ? typ[h] : null }));
    const hasAnyHistory = hours.some((x) => x.v != null);
    const today = extremes(typ);
    const week = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const curve = ride.typical && ride.typical.dow && ride.typical.dow[d];
      const ex = curve && curve.filter((v) => v != null).length >= 4 ? extremes(curve) : null;
      return { d, ex };
    }).filter((x) => x.ex);
    const lastUpd = minutesAgo(l.updated);
    const max = Math.max(1, ...hours.map((x) => x.v || 0));
    const ll = lightningLane(l, look, R);
    const tone = TONES[ll.tone];
    const target = alertFor(ride.id);
    const isDown = l.status === 'DOWN' || l.status === 'CLOSED';
    const remind = remindOn(ride.id, l.status);
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.topBar}>
          <Pressable style={s.ghostBtn} onPress={() => setScreen('next')} accessibilityRole="button">
            <Text style={s.ghostBtnText}>‹ Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
          {bannerView}
          <Text style={s.kicker}>{ride.land}{ride.parkId !== park.id ? ` · ${shortPark(ride.parkName)}` : ''}{ride.indoor ? ' · Indoors' : ''}</Text>
          <Text style={s.h1}>{ride.name}</Text>
          <Text style={s.big}>{l.status && l.status !== 'OPERATING' ? 'Temporarily closed' : l.wait != null ? `${l.wait} min wait now` : 'No wait posted'}</Text>
          {l.singleRider != null ? <Text style={[s.body, { fontWeight: '600', color: C.blue }]}>Single Rider: {l.singleRider} min</Text> : null}
          <Text style={s.mutedSmall}>{lastUpd ? `Wait time last updated ${lastUpd}` : updatedText}</Text>
          {fanWait(ride.id, l.wait) ? (
            <Text style={[s.body, { fontWeight: '700', color: C.accent }]}>
              {fanWait(ride.id, l.wait).same ? `Ride Next guests say the posted wait is about right (${fanWait(ride.id, l.wait).n} queues)`
                : `Ride Next guests actually wait about ${fanWait(ride.id, l.wait).est} min (${fanWait(ride.id, l.wait).n} queues)`}
            </Text>
          ) : null}
          {queueCard}
          {!saved.queue && l.status === 'OPERATING' ? (
            <Pressable style={s.btnDark} onPress={() => startQueue({ ...ride, posted: l.wait != null, wait: l.wait || 0, standby: l.wait || 0 })} accessibilityRole="button">
              <Text style={s.btnDarkText}>I'm in the queue</Text>
            </Pressable>
          ) : null}

          <View style={s.card}>
            <Text style={s.h3}>Wait alert</Text>
            <Text style={s.muted}>
              {target ? `We'll buzz you when it's ${target} min or less.` : "Pick a wait and we'll buzz you when it gets there."}
            </Text>
            <View style={s.chips}>
              {[15, 20, 30, 45, 60].map((m) => (
                <Pressable key={m} onPress={() => setWaitAlert(ride.id, target === m ? null : m)} accessibilityRole="button"
                  accessibilityState={{ selected: target === m }} style={[s.chip, target === m && s.chipOn]}>
                  <Text style={[s.chipText, target === m && { color: '#fff' }]}>≤ {m} min</Text>
                </Pressable>
              ))}
              {target ? (
                <Pressable onPress={() => setWaitAlert(ride.id, null)} accessibilityRole="button" style={s.chip}>
                  <Text style={s.chipText}>Turn off</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={s.mutedSmall}>Works while the app is open. Alerts with the app closed are coming soon.</Text>
          </View>

          {isDown ? (
            <View style={[s.card, { backgroundColor: C.redSoft, borderColor: '#FECACA' }]}>
              <Text style={s.h3}>{l.status === 'DOWN' ? 'Temporarily down' : 'Closed right now'}</Text>
              <Text style={s.body}>{remind ? "We'll buzz you the moment it opens. Lines are short for a few minutes after."
                : 'Want a buzz the moment it opens? Lines are short for a few minutes after.'}</Text>
              <Pressable style={[s.btnDark, { flexDirection: 'row', gap: 10 }]} onPress={() => toggleRemind(ride.id, l.status)} accessibilityRole="button">
                <Icon name="bell" size={20} tone="white" />
                <Text style={s.btnDarkText}>{remind ? 'Reminder on · tap to cancel' : 'Remind me when it opens'}</Text>
              </Pressable>
              <Text style={s.mutedSmall}>Works while Ride Next is open.</Text>
            </View>
          ) : null}

          {ride.heightCm ? (
            <View style={s.card}>
              <Text style={s.h3}>Height: {R.metric ? `${ride.heightCm} cm` : `${ride.height} in (${ride.heightCm} cm)`}</Text>
              <Text style={s.body}>
                {R.switchName}: if someone in your group is too short, one adult waits with them while the others ride,
                then swaps and rides without queuing again. Ask the Cast Member at the entrance.
              </Text>
            </View>
          ) : null}

          {today ? (
            <View style={s.card}>
              <Text style={s.h3}>A typical {DAY_NAMES[now.dow]}</Text>
              <View style={s.row}>
                <View style={[s.extreme, { backgroundColor: '#FEF2F2' }]}>
                  <Text style={s.mutedSmall}>Busiest</Text>
                  <Text style={s.extremeValue}>{fmtHour(today.busiest.hour)}</Text>
                  <Text style={s.mutedSmall}>about {today.busiest.wait} min</Text>
                </View>
                <View style={[s.extreme, { backgroundColor: '#F0FDF4' }]}>
                  <Text style={s.mutedSmall}>Shortest</Text>
                  <Text style={s.extremeValue}>{fmtHour(today.quietest.hour)}</Text>
                  <Text style={s.mutedSmall}>about {today.quietest.wait} min</Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={s.card}>
            <Text style={s.h3}>Typical waits by hour</Text>
            {!hasAnyHistory ? (
              <Text style={s.muted}>Not enough history yet. This fills in as Ride Next collects waits over the next few days.</Text>
            ) : (
              <>
                <View style={{ gap: 4, marginTop: 4 }} accessibilityLabel="Typical wait for each hour">
                  {hours.map((x) => {
                    const isNow = x.h === now.hour;
                    return (
                      <View key={x.h} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 }}
                        accessibilityLabel={`${fmtHour(x.h)}, ${x.v == null ? 'no data yet' : `about ${x.v} minutes`}${isNow ? ', this hour' : ''}`}>
                        <Text style={{ width: 62, fontSize: 13, fontWeight: isNow ? '800' : '600', color: isNow ? C.accent : C.ink }}>{fmtHour(x.h)}</Text>
                        <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: '#F1F5F9', overflow: 'hidden' }}>
                          {x.v == null ? null : <View style={{ width: `${Math.max(3, Math.round((x.v / max) * 100))}%`, height: 12, borderRadius: 6, backgroundColor: isNow ? C.accent : '#94A3B8' }} />}
                        </View>
                        <Text style={{ width: 52, textAlign: 'right', fontSize: 13, fontWeight: isNow ? '800' : '600', color: x.v == null ? '#94A3B8' : isNow ? C.accent : C.muted }}>{x.v == null ? '—' : `${x.v} min`}</Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={s.mutedSmall}>Orange = this hour.{hours.some((x) => x.v == null) ? ' "—" = no data yet, fills in over the coming days.' : ''}</Text>
              </>
            )}
          </View>

          {week.length > 0 ? (
            <View style={s.card}>
              <Text style={s.h3}>Each day of the week</Text>
              {week.map(({ d, ex }) => (
                <View key={d} style={[s.weekRow, d === now.dow && { backgroundColor: '#F1F5F9' }]}>
                  <Text style={[s.rowTitle, { width: 96 }]}>{DAY_NAMES[d].slice(0, 3)}{d === now.dow ? ' (today)' : ''}</Text>
                  <Text style={[s.mutedSmall, { flex: 1 }]}>Shortest {fmtHour(ex.quietest.hour)} · {ex.quietest.wait} min</Text>
                  <Text style={[s.mutedSmall, { flex: 1, textAlign: 'right' }]}>Busiest {fmtHour(ex.busiest.hour)} · {ex.busiest.wait} min</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.h3}>Each day of the week</Text>
              <Text style={s.muted}>Busiest and shortest times for each day will appear once a few weeks of waits have been logged.</Text>
            </View>
          )}

          {look.when ? (
            <View style={[s.card, look.when.now ? { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' } : { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
              <Text style={s.kicker}>When to ride</Text>
              <Text style={[s.h3, { color: look.when.now ? C.green : C.blue }]}>
                {look.when.now ? 'Ride now' : `Wait until about ${fmtHour(look.when.hour)}`}
              </Text>
              <Text style={s.body}>
                {look.when.now ? 'Based on past days, the line won\'t get much shorter later today.'
                  : `Based on past days, it's usually about ${look.when.wait} min then, about ${look.when.save} min less than now.`}
              </Text>
            </View>
          ) : null}

          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.h3}>{R.payShort}: worth it?</Text>
              <View style={[s.pill, { backgroundColor: tone.bg }]}><Text style={[s.pillText, { color: tone.fg }]}>{ll.verdict}</Text></View>
            </View>
            <Text style={s.body}>{ll.body}</Text>
            {ll.price ? <Text style={s.mutedSmall}>{R.payName} price right now: {R.cur}{ll.price} per person</Text> : null}
            {l.multiReturn ? <Text style={s.mutedSmall}>Multi Pass return times currently from {fmtTime(l.multiReturn)}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ----- Ride next -----
  if (screen === 'next') {
    const top = plan.ranked[0];
    const rest = plan.ranked.slice(1);
    const parksHere = saved.hopper ? data.parks : [park];

    // food
    const foodHere = park.food.filter((f) => !mood || (mood === 'fav' ? !!f.fav : f.moods.includes(mood)));
    const moodsHere = ['fav', ...Object.keys(MOOD_LABELS).filter((m) => park.food.some((f) => f.moods.includes(m)))];
    const hoursToday = (f) => (f.hours && f.hours[now.dateKey]) || null;
    const isOpen = (f) => {
      const st = (live[f.id] || {}).status;
      if (st) return st === 'OPERATING';
      const h = hoursToday(f);
      return h ? openAt(h, now.minute) : null; // null = we don't know
    };
    const closesAt = (f) => {
      const h = hoursToday(f);
      const r = h && h.find(([o, c]) => openAt([[o, c]], now.minute));
      return r ? r[1] : null;
    };
    const openFood = foodHere
      .filter((f) => f.service !== 'table')
      .filter((f) => isOpen(f) !== false)
      .map((f) => ({ ...f, walk: saved.useLoc ? walkMinutes(coords, f.loc) : null, open: isOpen(f), until: closesAt(f) }))
      .sort((a, b) => {
        if (a.walk != null && b.walk != null) return a.walk - b.walk;
        if (!!a.fav !== !!b.fav) return a.fav ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const sitDown = foodHere.filter((f) => f.service === 'table').sort((a, b) => (Number(!!b.fav) - Number(!!a.fav)) || a.name.localeCompare(b.name));

    // shows
    const showList = Object.entries(live)
      .filter(([, v]) => v.type === 'SHOW' && parksHere.some((p) => p.id === v.parkId) && v.showtimes && v.showtimes.length)
      .flatMap(([id, v]) => v.showtimes.map((t) => ({ id, name: v.name, start: t, parkId: v.parkId })))
      .filter((x) => Date.parse(x.start) > Date.now() - 5 * 60000)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    // snacks
    const snackMenu = [
      ...(SNACKS[`${R.key}:${park.name}`] || []),
      ...(saved.customSnacks || []).map((x) => ({ ...x, where: 'Added by you', custom: true })),
    ];
    const snackTotal = Object.values(snackCountsToday).reduce((a, b) => a + b, 0);

    // Lightning Lane coach
    const llNow = saved.ll && saved.ll.dateKey === now.dateKey ? saved.ll : null;
    const nextBookAt = llNow && !llNow.used ? llNow.bookedAt + MULTI_PASS_GAP_MIN * 60000 : null;
    const canBook = !nextBookAt || Date.now() >= nextBookAt;
    const llPick = plan.ranked
      .filter((r) => r.multi === 'AVAILABLE' && r.standby >= 20 && (!llNow || r.id !== llNow.rideId || llNow.used))
      .sort((a, b) => (b.standby + (b.look.trend === 'up' ? 15 : 0)) - (a.standby + (a.look.trend === 'up' ? 15 : 0)))[0];

    // height
    const hiddenTall = parksHere.flatMap((p) => p.rides.filter((r) => (saved.selected[p.id] || []).includes(r.id) && tooTall(r)));

    const quickToggles = [
      ['rain', 'Rainy day'], ['hopper', 'Park Hopper'], ['useSingle', 'Single Rider'], ['multiPass', 'Multi Pass'],
    ].filter(([key]) => key !== 'multiPass' || R.hasMulti);

    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.topBar}>
          <View style={s.row}>
            <Pressable style={s.ghostBtn} onPress={() => setScreen('welcome')} accessibilityRole="button">
              <Text style={s.ghostBtnText}>‹ Home</Text>
            </Pressable>
            <Pressable style={s.ghostBtn} onPress={() => setScreen('setup')} accessibilityRole="button">
              <Text style={s.ghostBtnText}>Edit list</Text>
            </Pressable>
            <Pressable style={s.ghostBtn} onPress={() => openRecap('next')} accessibilityRole="button">
              <Text style={s.ghostBtnText}>My day</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
          {bannerView}
          {ropeDropCard(park)}
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <Text style={s.mutedSmall}>{saved.hopper ? (data.parks.length > 2 ? 'All parks' : 'Both parks') : park.name} · {hoursLine(park)} · {updatedText}</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {!day ? (
              <Pressable onPress={startDay} accessibilityRole="button" style={[s.chip, s.chipOn]}>
                <Text style={[s.chipText, { color: '#fff' }]}>Start my day</Text>
              </Pressable>
            ) : null}
            {quickToggles.map(([key, label]) => (
              <Pressable key={key} onPress={() => setOpt(key, !saved[key])} accessibilityRole="switch"
                accessibilityState={{ checked: !!saved[key] }} style={[s.chip, saved[key] && s.chipOn]}>
                <Text style={[s.chipText, saved[key] && { color: '#fff' }]}>{saved[key] ? '✓ ' : ''}{label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {queueCard}
          {!plan.parkClosed && crowdFor(park) ? (
            <View style={s.card}>
              <CrowdMeter c={crowdFor(park)} />
            </View>
          ) : null}
          {plan.parkClosed ? (
            <View style={s.card}><Text style={s.h3}>The park looks closed right now</Text><Text style={s.muted}>Waits will appear here when it opens.</Text></View>
          ) : top ? (
            <View style={s.hero}>
              <Text style={s.heroKicker}>RIDE NEXT{top.otherPark ? ` · IN ${shortPark(top.parkName).toUpperCase()}` : ''}</Text>
              <Text style={s.heroTitle}>{top.name}</Text>
              <Text style={{ color: '#CBD5E1', fontSize: 14, marginTop: -6 }}>{top.land}{top.indoor ? ' · Indoors' : ''}</Text>
              <View style={s.statRow}>
                {top.viaSingle ? (
                  <>
                    <Stat label="Single Rider" value={`${top.wait} min`} />
                    <Stat label="Standby" value={`${top.standby} min`} />
                  </>
                ) : (
                  <Stat label="Wait now" value={top.posted ? `${top.wait} min` : 'No wait'} />
                )}
                {top.look.when && !top.look.when.now ? <Stat label={`At ${fmtHour(top.look.when.hour)}`} value={`~${top.look.when.wait} min`} />
                  : top.look.when ? <Stat label="Later today" value="Not shorter" /> : null}
                {top.walk != null ? <Stat label="Walk" value={`${top.walk} min`} /> : top.otherPark ? <Stat label={R.hopLabel} value={`~${R.hopMin} min`} /> : null}
              </View>
              {!top.viaSingle && fanWait(top.id, top.posted ? top.wait : 0) ? (
                <Text style={{ color: '#FDE68A', fontSize: 14, fontWeight: '700' }}>
                  {fanWait(top.id, top.wait).same ? `Ride Next guests say the posted wait is about right (${fanWait(top.id, top.wait).n} queues)`
                    : `Ride Next guests actually wait about ${fanWait(top.id, top.wait).est} min here (${fanWait(top.id, top.wait).n} queues)`}
                </Text>
              ) : null}
              <Text style={s.heroBody}>{reasonFor(top, saved.rain)}</Text>
              {!saved.useSingle && top.singleRider != null && top.singleRider + 10 <= top.standby ? (
                <Text style={{ color: C.accentSoft, fontSize: 14 }}>Single Rider is only {top.singleRider} min here. Turn on Single Rider above to use it.</Text>
              ) : null}
              {saved.queue && saved.queue.id === top.id ? null : (
                <>
                  <View style={s.row}>
                    <Pressable style={[s.btnLight, { flex: 1 }]} onPress={() => startQueue(top)} accessibilityRole="button">
                      <Text style={s.btnLightText}>I'm in the queue</Text>
                    </Pressable>
                    <Pressable style={s.btnOutlineDark} onPress={() => skipRide(top)} accessibilityRole="button">
                      <Text style={s.btnOutlineDarkText}>Skip</Text>
                    </Pressable>
                  </View>
                  <Pressable onPress={() => markDone(top)} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                    <Text style={{ color: '#CBD5E1', fontWeight: '600' }}>Already ridden it? Mark as done</Text>
                  </Pressable>
                </>
              )}
              <Pressable onPress={() => openRide(top.id)} accessibilityRole="button" style={{ paddingVertical: 10 }}>
                <Text style={{ color: C.accentSoft, fontWeight: '600' }}>Wait pattern, alerts & {R.payShort} ›</Text>
              </Pressable>
            </View>
          ) : selected.length === 0 ? (
            <View style={s.card}><Text style={s.h3}>No rides picked yet</Text><Text style={s.muted}>Tap Edit list to choose what you want to ride.</Text></View>
          ) : (
            <View style={s.card}><Text style={s.h3}>You've done your whole list</Text><Text style={s.muted}>Add more from Edit list, or go find a snack.</Text></View>
          )}

          {saved.multiPass && R.hasMulti ? (
            <View style={s.card}>
              <Text style={s.kicker}>Lightning Lane coach</Text>
              {llNow && !llNow.used && !canBook ? (
                <>
                  <Text style={s.body}>
                    Booked: {llNow.rideName}. You can book your next one at {clockFromMs(nextBookAt, data.utcOffsetMinutes)},
                    or as soon as you've ridden it.
                  </Text>
                  <Pressable style={s.btnDark} onPress={usedMulti} accessibilityRole="button"><Text style={s.btnDarkText}>I've used it</Text></Pressable>
                </>
              ) : llPick ? (
                <>
                  <Text style={s.body}>
                    {llNow && !llNow.used ? "It's been 2 hours, so you can book another now. " : ''}
                    Book {llPick.name} next: standby is {llPick.standby} min{llPick.look.trend === 'up' ? ' and getting longer' : ''}.
                    {llPick.multiReturn ? ` Return times are currently from ${fmtTime(llPick.multiReturn)}, so book soon.` : ''}
                  </Text>
                  <Pressable style={s.btnDark} onPress={() => bookedMulti(llPick)} accessibilityRole="button"><Text style={s.btnDarkText}>I booked it</Text></Pressable>
                  <Text style={s.mutedSmall}>Book in the Disneyland app. We'll remind you when you can book the next one.</Text>
                </>
              ) : (
                <Text style={s.body}>None of the rides left on your list need Lightning Lane right now. Their standby lines are short.</Text>
              )}
            </View>
          ) : null}

          <Pressable style={s.listBtn} onPress={() => setShowsOpen((o) => !o)} accessibilityRole="button">
            <Text style={s.listBtnText}>Shows & fireworks today{showList.length ? ` · ${showList.length}` : ''}</Text>
            <Text style={s.listBtnText}>{showsOpen ? '–' : '+'}</Text>
          </Pressable>
          {showsOpen ? (
            <View style={s.card}>
              {showList.length === 0 ? <Text style={s.muted}>No more showtimes listed for today.</Text> : showList.slice(0, 12).map((x) => {
                const key = `${x.id}@${x.start}`;
                const on = !!(saved.reminders || {})[key];
                const big = BIG_SHOW.test(x.name);
                return (
                  <View key={key} style={s.foodRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowTitle, big && { color: C.accent }]}>{x.name}</Text>
                      <Text style={s.mutedSmall}>{fmtTime(x.start.slice(11, 16))}{saved.hopper ? ` · ${shortPark((data.parks.find((p) => p.id === x.parkId) || {}).name)}` : ''}{big ? ' · get there early for a good spot' : ''}</Text>
                    </View>
                    <Pressable onPress={() => toggleReminder(key, x.start, x.name)} accessibilityRole="button"
                      style={[s.linkBtn, on && { backgroundColor: C.blue }]}>
                      <Text style={[s.linkBtnText, on && { color: '#fff' }]}>{on ? 'Reminder on' : 'Remind me'}</Text>
                    </Pressable>
                  </View>
                );
              })}
              <Text style={s.mutedSmall}>Reminders go off 45 minutes before fireworks and parades, 20 minutes before other shows.</Text>
            </View>
          ) : null}

          <Pressable style={s.listBtn} onPress={() => setFoodOpen((o) => !o)} accessibilityRole="button">
            <Text style={s.listBtnText}>Hungry? What's open now</Text>
            <Text style={s.listBtnText}>{foodOpen ? '–' : '+'}</Text>
          </Pressable>
          {foodOpen ? (
            <View style={s.card}>
              <Text style={s.h3}>What are you in the mood for?</Text>
              <View style={s.chips}>
                {moodsHere.map((m) => {
                  const on = mood === m;
                  return (
                    <Pressable key={m} onPress={() => setMood(on ? null : m)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={[s.chip, on && s.chipOn]}>
                      <Text style={[s.chipText, on && { color: '#fff' }]}>{m === 'fav' ? '★ Fan favourites' : MOOD_LABELS[m]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.kicker}>Quick bites{saved.useLoc ? ', closest first' : ''}</Text>
              {openFood.length === 0 ? <Text style={s.muted}>Nothing matching is open right now.</Text> : openFood.slice(0, 12).map((f) => (
                <FoodRow key={f.id} f={f} fan={(fans && fans.ratings && fans.ratings[f.name]) || null} ateCount={mealsToday[f.name] || 0} rating={(saved.ratings || {})[f.name]}
                  onAte={() => ateHere(f)} onRate={(n) => rateMeal(f.name, n)}
                  right={(
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.mutedSmall, { color: f.open ? C.green : C.muted, fontWeight: '600' }]}>
                        {f.open ? (f.until ? `Open until ${fmtTime(f.until)}` : 'Open') : 'Hours not listed'}
                      </Text>
                      {f.walk != null ? <Text style={s.mutedSmall}>{f.walk} min walk</Text> : null}
                    </View>
                  )} />
              ))}
              {sitDown.length > 0 ? (
                <>
                  <Text style={[s.kicker, { marginTop: 12 }]}>Fancy a sit-down meal?</Text>
                  {sitDown.slice(0, 6).map((f) => (
                    <FoodRow key={f.id} f={f} fan={(fans && fans.ratings && fans.ratings[f.name]) || null} ateCount={mealsToday[f.name] || 0} rating={(saved.ratings || {})[f.name]}
                      onAte={() => ateHere(f)} onRate={(n) => rateMeal(f.name, n)}
                      sub={hoursToday(f) ? `Today ${hoursToday(f).map(fmtRange).join(', ')}` : null}
                      right={(
                        <Pressable style={s.linkBtn} onPress={() => Linking.openURL(R.diningUrl)} accessibilityRole="link">
                          <Text style={s.linkBtnText}>Check availability</Text>
                        </Pressable>
                      )} />
                  ))}
                </>
              ) : null}
            </View>
          ) : null}

          <Pressable style={s.listBtn} onPress={() => setSnacksOpen((o) => !o)} accessibilityRole="button">
            <Text style={s.listBtnText}>Snack tracker{snackTotal ? ` · ${snackTotal} today` : ''}</Text>
            <Text style={s.listBtnText}>{snacksOpen ? '–' : '+'}</Text>
          </Pressable>
          {snacksOpen ? (
            <View style={s.card}>
              {snackMenu.map((x) => {
                const n = snackCountsToday[x.id] || 0;
                const hot = ((fans && fans.snacks && fans.snacks[park.id]) || []).findIndex((y) => y.snack === x.id);
                return (
                  <View key={x.id} style={s.foodRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{x.name}</Text>
                      {hot >= 0 && hot < 3 ? <Text style={[s.mutedSmall, { color: C.accent, fontWeight: '700' }]}>{hot === 0 ? 'Most logged by guests this week' : 'Popular with guests this week'}</Text> : null}
                      <Text style={s.mutedSmall}>{x.where}</Text>
                      {x.custom ? (
                        <Pressable onPress={() => removeCustomSnack(x.id)} accessibilityRole="button" style={{ paddingVertical: 4 }}>
                          <Text style={[s.mutedSmall, { color: C.red }]}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={s.counter}>
                      <Pressable onPress={() => bumpSnack(x.id, -1)} disabled={!n} accessibilityRole="button"
                        accessibilityLabel={`One less ${x.name}`} style={[s.counterBtn, !n && { opacity: 0.35 }]}>
                        <Text style={s.counterBtnText}>−</Text>
                      </Pressable>
                      <Text style={s.counterValue}>{n}</Text>
                      <Pressable onPress={() => bumpSnack(x.id, 1)} accessibilityRole="button"
                        accessibilityLabel={`One more ${x.name}`} style={s.counterBtn}>
                        <Text style={s.counterBtnText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <View style={[s.row, { alignItems: 'center' }]}>
                <TextInput value={newSnack} onChangeText={setNewSnack} placeholder="Add your own (e.g. seasonal churro)"
                  placeholderTextColor="#64748B" style={s.input} returnKeyType="done"
                  onSubmitEditing={() => addCustomSnack(newSnack)} accessibilityLabel="New snack name" />
                <Pressable onPress={() => addCustomSnack(newSnack)} accessibilityRole="button" style={s.addBtn}>
                  <Text style={s.addBtnText}>Add</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {rest.length > 0 ? (
            <View style={s.rowBetween}>
              <Text style={s.kicker}>Rest of your list</Text>
              <View style={s.toggle}>
                {[['best', 'Best next'], ['area', 'By area']].map(([k, label]) => (
                  <Pressable key={k} onPress={() => setSortBy(k)} accessibilityRole="button" accessibilityState={{ selected: sortBy === k }}
                    style={[s.toggleBtn, sortBy === k && s.toggleBtnOn]}>
                    <Text style={[s.toggleText, sortBy === k && { color: '#fff' }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {(sortBy === 'area'
            ? [...rest].sort((a, b) => (a.parkId === b.parkId ? 0 : a.parkId === park.id ? -1 : 1)
              || (a.landOrder ?? 99) - (b.landOrder ?? 99) || a.name.localeCompare(b.name))
            : rest).map((r, i, arr) => (
            <View key={r.id} style={{ gap: 6 }}>
              {sortBy === 'area' && (i === 0 || arr[i - 1].land !== r.land) ? <Text style={s.landHeader}>{r.land || 'Other'}</Text> : null}
              <Pressable style={s.rideRow} onPress={() => openRide(r.id)} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.name}</Text>
                  {sortBy === 'best' || r.otherPark ? (
                    <Text style={s.mutedSmall}>{[r.otherPark ? shortPark(r.parkName) : null, sortBy === 'best' ? r.land : null, r.indoor && saved.rain ? 'Indoors' : null].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  <WhenLabel look={r.look} />
                  {alertFor(r.id) ? <Text style={[s.mutedSmall, { color: C.blue, fontWeight: '600' }]}>Alert at ≤ {alertFor(r.id)} min</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.rowWait}>{r.posted ? `${r.wait} min` : '—'}</Text>
                  {r.viaSingle ? <Text style={[s.mutedSmall, { color: C.blue }]}>Single Rider</Text>
                    : r.singleRider != null ? <Text style={s.mutedSmall}>SR {r.singleRider} min</Text> : null}
                </View>
              </Pressable>
            </View>
          ))}
          {plan.down.map((r) => (
            <Pressable key={r.id} style={s.rideRow} onPress={() => openRide(r.id)} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Text style={[s.rowTitle, { color: C.muted }]}>{r.name}</Text>
                {r.status === 'REFURBISHMENT' ? <Text style={s.mutedSmall}>Closed for refurbishment, back another day</Text> : null}
                {r.status !== 'REFURBISHMENT' ? (
                  <Pressable onPress={() => toggleRemind(r.id, r.status)} hitSlop={8} accessibilityRole="switch"
                    accessibilityState={{ checked: remindOn(r.id, r.status) }} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="bell" size={16} tone="blue" />
                    <Text style={[s.mutedSmall, { color: C.blue, fontWeight: '700', flexShrink: 1 }]}>
                      {remindOn(r.id, r.status) ? "Reminder on: we'll buzz you when it opens" : 'Remind me when it opens'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={[s.pill, { backgroundColor: C.redSoft }]}><Text style={[s.pillText, { color: C.red }]}>{r.status === 'REFURBISHMENT' ? 'Refurbishment' : 'Temporarily closed'}</Text></View>
            </Pressable>
          ))}
          {hiddenTall.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Hidden for height</Text>
              <Text style={s.muted}>
                {hiddenTall.length} ride{hiddenTall.length === 1 ? '' : 's'} on your list {hiddenTall.length === 1 ? 'is' : 'are'} too tall for your shortest rider. With {R.switchName}, the grown-ups can still ride. Tap one for details.
              </Text>
              {hiddenTall.map((r) => (
                <Pressable key={r.id} style={s.listLine} onPress={() => openRide(r.id)} accessibilityRole="button">
                  <Text style={[s.body, { flex: 1 }]}>{r.name}</Text>
                  <Text style={s.mutedSmall}>{heightLabel(R, r)} · {R.switchName}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={[s.mutedSmall, { marginTop: 16 }]}>Wait times are posted estimates from an unofficial feed and can change quickly.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ----- Setup -----
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Pressable style={[s.ghostBtn, { alignSelf: 'flex-start' }]} onPress={() => setScreen('welcome')} accessibilityRole="button">
          <Text style={s.ghostBtnText}>‹ Home</Text>
        </Pressable>
        <Text style={s.kicker}>{park.name}</Text>
        <Text style={s.h1}>Plan my day</Text>
        <Text style={[s.mutedSmall, { color: C.ink, fontWeight: '600' }]}>{hoursLine(park)}</Text>
        <Text style={s.mutedSmall}>{updatedAt ? `Live waits updated ${minutesAgo(updatedAt)}` : 'Loading live waits…'}</Text>
      </View>
      <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
        {ropeDropCard(park)}
        <View style={s.card}>
          <Text style={s.h3}>Your day</Text>
          {[
            ['hopper', 'I have a Park Hopper', data && data.parks.length > 2 ? 'Suggest rides in every park (travel time included)' : 'Suggest rides in both parks'],
            ['useSingle', 'Happy to ride Single Rider', 'Use it when it\'s quicker'],
            ['multiPass', 'I have Lightning Lane Multi Pass', 'Get tips on what to book and when'],
            ['rain', 'Rainy day mode', 'Put indoor rides first'],
          ].filter(([key]) => key !== 'multiPass' || R.hasMulti).map(([key, title, sub]) => (
            <Pressable key={key} style={s.optionRow} onPress={() => setOpt(key, !saved[key])}
              accessibilityRole="switch" accessibilityState={{ checked: !!saved[key] }} accessibilityLabel={title}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{title}</Text>
                <Text style={s.mutedSmall}>{sub}</Text>
              </View>
              <Switch value={!!saved[key]} onValueChange={(v) => setOpt(key, v)} />
            </Pressable>
          ))}
          <Text style={[s.rowTitle, { marginTop: 8 }]}>Shortest rider in your group</Text>
          <View style={s.chips}>
            {R.heightOptions.map((h) => {
              const cm = toCm(R, h);
              const on = minH === cm;
              return (
                <Pressable key={String(h)} onPress={() => setOpt('minHeightCm', cm)} accessibilityRole="button"
                  accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && { color: '#fff' }]}>{h == null ? 'No limit' : `${h} ${R.metric ? 'cm' : 'in'}`}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={s.muted}>Tap the rides you want to do today.</Text>
        {park.rides.map((r, i, arr) => {
          const on = selected.includes(r.id);
          const header = i === 0 || arr[i - 1].land !== r.land
            ? <Text style={s.landHeader}>{r.land || 'Other'}</Text> : null;
          const l = live[r.id] || {};
          const label = l.status && l.status !== 'OPERATING' ? 'Closed' : l.wait != null ? `${l.wait} min` : '';
          const tall = tooTall(r);
          return (
            <View key={r.id} style={{ gap: 6 }}>
              {header}
              <Pressable style={[s.rideRow, tall && { opacity: 0.6 }]} onPress={() => toggleRide(r.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <View style={[s.check, on && s.checkOn]}>{on ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.name}</Text>
                  {r.heightCm ? <Text style={[s.mutedSmall, tall && { color: C.red }]}>{tall ? `Needs ${heightLabel(R, r)} · ${R.switchName}` : heightLabel(R, r)}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.rowWaitSmall}>{label}</Text>
                  {l.singleRider != null && l.status === 'OPERATING' ? <Text style={s.mutedSmall}>SR {l.singleRider} min</Text> : null}
                </View>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.footer}>
        <Pressable style={s.rowBetween} onPress={() => setSaved((cur) => ({ ...cur, shareStats: cur.shareStats === false, outbox: cur.shareStats === false ? cur.outbox : [] }))}
          accessibilityRole="switch" accessibilityState={{ checked: saved.shareStats !== false }} accessibilityLabel="Share anonymous stats">
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Share anonymous stats</Text>
            <Text style={s.mutedSmall}>Your real queue times, snacks and ratings help every guest. No name, no location.</Text>
          </View>
          <Switch value={saved.shareStats !== false}
            onValueChange={(v) => setSaved((cur) => ({ ...cur, shareStats: v, outbox: v ? cur.outbox : [] }))} />
        </Pressable>
        <Pressable style={s.rowBetween} onPress={() => toggleLoc(!saved.useLoc)}
          accessibilityRole="switch" accessibilityState={{ checked: !!saved.useLoc }} accessibilityLabel="Use my location">
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Use my location</Text>
            <Text style={s.mutedSmall}>{saved.useLoc ? 'Adds walking time and areas visited' : 'Off: turn on for walking times and areas visited'}</Text>
          </View>
          <Switch value={!!saved.useLoc} onValueChange={toggleLoc} />
        </Pressable>
        <Pressable style={[s.btnDark, selected.length === 0 && { opacity: 0.5 }]} disabled={selected.length === 0}
          onPress={() => { startDay(); setScreen('next'); }} accessibilityRole="button">
          <Text style={s.btnDarkText}>Start my day · {selected.length} rides</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function FoodRow({ f, ateCount, rating, onAte, onRate, right, sub, fan = null }) {
  return (
    <View style={[s.foodRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{f.name}</Text>
          {f.fav ? <Text style={[s.mutedSmall, { color: C.accent, fontWeight: '600' }]}>★ Fan favourite · {f.fav}</Text> : null}
          {fan ? <Text style={[s.mutedSmall, { color: '#B45309', fontWeight: '700' }]}>{`${fan.avg.toFixed(1)} ★ from ${fan.n} Ride Next guests`}</Text> : null}
          <Text style={s.mutedSmall}>{sub || `${f.moods.map((m) => MOOD_LABELS[m]).join(' · ')}${f.service === 'snack' ? ' · snack stand' : ''}`}</Text>
        </View>
        {right}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Pressable onPress={onAte} accessibilityRole="button" style={s.smallBtn}>
          <Text style={s.smallBtnText}>{ateCount ? `Ate here ×${ateCount}` : 'I ate here'}</Text>
        </Pressable>
        {ateCount || rating ? <Stars value={rating || 0} onRate={onRate} /> : null}
      </View>
    </View>
  );
}

function Stars({ value, onRate }) {
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={`Your rating: ${value || 'none'} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onRate(n)} accessibilityRole="button" accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
          style={{ minWidth: 32, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: n <= value ? '#D97706' : '#CBD5E1' }}>{n <= value ? '★' : '☆'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function reasonFor(r, rain) {
  const near = r.walk != null && r.walk <= 6 ? ' and it\'s close by' : '';
  const extra = [
    r.viaSingle ? `Single Rider saves you about ${r.standby - r.wait} min.` : '',
    rain && r.indoor ? 'It\'s indoors, so you\'ll stay dry.' : '',
    r.otherPark ? `It's in ${shortPark(r.parkName)}, about ${r.hop} minutes away.` : '',
  ].filter(Boolean).join(' ');
  return `${reasonText(r, near)}${extra ? ` ${extra}` : ''}`;
}

function reasonText(r, near) {
  const w = r.look.when;
  if (w && !w.now) return `It's usually about ${w.wait} min around ${fmtHour(w.hour)}, so you could save ${w.save} min by waiting. It's still the best pick on your list right now${near}.`;
  if (w && w.now && r.look.trend !== 'unknown') return `History says it won't get much shorter later today, so ride it now${near}.`;
  switch (r.look.trend) {
    case 'up': return `The line usually grows to about ${r.look.later} min over the next few hours. Riding now saves you time${near}.`;
    case 'down': return r.look.best
      ? `This line usually drops to about ${r.look.best.wait} min around ${fmtHour(r.look.best.hour)}, but it's still your best option right now${near}.`
      : `This line usually gets shorter later, but it's your best option right now${near}.`;
    case 'steady': return `The line usually stays about the same, and it's one of your shortest right now${near}.`;
    default: return `Shortest wait on your list right now${near}.`;
  }
}

function Stat({ label, value }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function WhenLabel({ look }) {
  const w = look && look.when;
  const [text, color] = !w ? ['Not enough history yet', C.muted]
    : w.now ? ['✓ Ride now', C.green]
      : [`⏱ Better at ${fmtHour(w.hour)} · ~${w.wait} min`, C.blue];
  return <Text style={{ color, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{text}</Text>;
}

// ---------- Day Wrapped slides (drawn at 360×640, scaled by k) ----------
function Dot({ k, size, color, l = undefined, r = undefined, t = undefined, b = undefined, ring = 0 }) {
  const st = { position: 'absolute', width: size * k, height: size * k, borderRadius: (size * k) / 2 };
  if (l != null) st.left = l * k;
  if (r != null) st.right = r * k;
  if (t != null) st.top = t * k;
  if (b != null) st.bottom = b * k;
  if (ring) { st.borderWidth = ring * k; st.borderColor = color; } else { st.backgroundColor = color; }
  return <View style={st} />;
}

function Brand({ k, fg, bg, inline = false }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 * k },
      inline ? null : { position: 'absolute', top: 24 * k, left: 24 * k }]}>
      <View style={{ width: 22 * k, height: 22 * k, borderRadius: 11 * k, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: bg, fontSize: 14 * k, fontWeight: '900', lineHeight: 16 * k }}>→</Text>
      </View>
      <Text style={{ color: fg, fontSize: 15 * k, fontWeight: '800' }}>Ride Next</Text>
    </View>
  );
}

const tx = (k, size, color, extra) => ({ color, fontSize: size * k, ...(extra || {}) });

function WrapOpen({ k, c, d }) {
  // one word per line, sized so the longest word fits the slide (312 of 360 wide)
  const titleLines = ['Your', ...d.resortShort.split(' '), 'Day'];
  const longest = Math.max(...titleLines.map((x) => x.length));
  const titleSize = Math.min(60, Math.floor(312 / (longest * 0.62)));
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Dot k={k} size={340} color={c.a} r={-130} t={460} />
      <Dot k={k} size={150} color={c.b} l={-55} b={-45} />
      <Dot k={k} size={64} color={c.ring} ring={6} r={34} t={60} />
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 140 * k, gap: 14 * k }}>
        <Text style={tx(k, 15, c.kicker, { fontWeight: '800', letterSpacing: 1.2 * k })}>{d.dateLabel}</Text>
        <View>
          {titleLines.map((line, i) => (
            <Text key={i} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
              style={tx(k, titleSize, c.fg, { fontWeight: '900', lineHeight: titleSize * 1.04 * k, letterSpacing: -1 * k })}>{line}</Text>
          ))}
        </View>
        <Text style={tx(k, 18, c.sub, { fontWeight: '500', maxWidth: 250 * k })}>{d.openLine}</Text>
        <Text style={tx(k, 13, c.sub, { fontWeight: '800' })}>Tap to start</Text>
      </View>
    </View>
  );
}

function WrapRides({ k, c, d }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Dot k={k} size={420} color={c.ring} ring={28} l={-180} t={-150} />
      <Dot k={k} size={120} color={c.b} r={-30} b={150} />
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 165 * k, gap: 4 * k }}>
        <Text style={tx(k, 20, c.fg, { fontWeight: '800' })}>You rode</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={tx(k, 160, c.fg, { fontWeight: '900', lineHeight: 165 * k, letterSpacing: -4 * k })}>{d.rides}</Text>
        <Text style={tx(k, 28, c.fg, { fontWeight: '800' })}>{d.rides === 1 ? 'ride today' : 'rides today'}</Text>
        {d.crowdLine ? <Text style={tx(k, 17, c.fg, { fontWeight: '600', opacity: 0.85 })}>{d.crowdLine}</Text> : null}
      </View>
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, bottom: 40 * k, backgroundColor: c.card, borderRadius: 18 * k, padding: 16 * k, gap: 3 * k }}>
        <Text style={tx(k, 12, c.cardKicker, { fontWeight: '800', letterSpacing: 1 * k })}>YOUR TOP RIDE</Text>
        <Text numberOfLines={2} style={tx(k, 22, c.cardFg, { fontWeight: '900' })}>{d.topRide ? `${d.topRide.name} ×${d.topRide.n}` : 'Your adventure awaits'}</Text>
        <Text style={tx(k, 14, c.cardSub)}>{d.shortestLine}</Text>
      </View>
    </View>
  );
}

function WrapQueue({ k, c, d }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 318 * k, height: 14 * k, backgroundColor: c.stripe }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 344 * k, height: 14 * k, backgroundColor: c.stripe }} />
      <Dot k={k} size={150} color={c.circle} r={-40} t={-45} />
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 120 * k, gap: 4 * k }}>
        <Text style={tx(k, 20, c.fg, { fontWeight: '800' })}>You spent</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={tx(k, 76, c.fg, { fontWeight: '900', letterSpacing: -2 * k })}>{d.queueLabel}</Text>
        <Text style={tx(k, 24, c.fg, { fontWeight: '800' })}>in queues</Text>
      </View>
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 392 * k, gap: 12 * k }}>
        <Text numberOfLines={3} style={tx(k, 23, c.fg, { fontWeight: '900', lineHeight: 28 * k })}>{d.queueLine}</Text>
        <View style={{ backgroundColor: c.chipBg, borderRadius: 16 * k, paddingVertical: 14 * k, paddingHorizontal: 16 * k, flexDirection: 'row', alignItems: 'center', gap: 10 * k }}>
          <View style={{ width: 10 * k, height: 10 * k, borderRadius: 5 * k, backgroundColor: c.chipIcon }} />
          <Text numberOfLines={2} style={tx(k, 15, c.chipText, { fontWeight: '800', flex: 1 })}>{d.queueChip}</Text>
        </View>
      </View>
    </View>
  );
}

function WrapWalk({ k, c, d }) {
  const dots = [];
  for (let x = -10; x <= 370; x += 24) dots.push({ x, y: 545 - 45 * Math.sin((x + 20) / 60) - x * 0.25 });
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {dots.map((p, i) => <Dot key={i} k={k} size={8} color={c.path} l={p.x} t={p.y} />)}
      <Dot k={k} size={200} color={c.circle} r={-70} t={-60} />
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 150 * k, gap: 4 * k }}>
        <Text style={tx(k, 20, c.fg, { fontWeight: '800' })}>Your feet carried you</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 * k }}>
          <Text numberOfLines={1} style={tx(k, 116, c.fg, { fontWeight: '900', letterSpacing: -4 * k })}>{d.dist}</Text>
          <Text style={tx(k, 34, c.fg, { fontWeight: '900' })}>{d.distUnit}</Text>
        </View>
        <Text style={tx(k, 20, c.sub, { fontWeight: '800' })}>{d.stepsLabel}</Text>
      </View>
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 372 * k, gap: 8 * k }}>
        <Text style={tx(k, 24, c.fg, { fontWeight: '900' })}>{d.areasLine}</Text>
        <Text style={tx(k, 17, c.sub)}>{d.missedLine}</Text>
      </View>
    </View>
  );
}

function WrapSnacks({ k, c, d }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Dot k={k} size={260} color={c.circleA} l={-110} b={-110} />
      <Dot k={k} size={90} color={c.circleB} r={28} t={14} />
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 120 * k, gap: 16 * k }}>
        <Text style={tx(k, 42, c.fg, { fontWeight: '900', letterSpacing: -1 * k })}>Snack report</Text>
        <View style={{ gap: 10 * k }}>
          {(d.snacks.length ? d.snacks.slice(0, 4) : [{ name: 'No snacks logged', n: 0 }]).map((x) => (
            <View key={x.name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 * k,
              backgroundColor: c.rowBg, borderRadius: 14 * k, paddingVertical: 11 * k, paddingHorizontal: 16 * k }}>
              <Text numberOfLines={1} style={tx(k, 17, c.rowFg, { fontWeight: '800', flex: 1 })}>{x.name}</Text>
              <Text style={tx(k, 24, c.count, { fontWeight: '900' })}>×{x.n}</Text>
            </View>
          ))}
        </View>
        <Text style={tx(k, 24, c.fg, { fontWeight: '900' })}>{d.snackLine}</Text>
      </View>
    </View>
  );
}

function WrapPersona({ k, c, d }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {PERSONA_STARS.map(([x, y, r], i) => <Dot key={i} k={k} size={r} color={c.star} l={x} t={y} />)}
      <View style={{ position: 'absolute', left: 65 * k, top: 100 * k, width: 230 * k, height: 230 * k, borderRadius: 115 * k,
        backgroundColor: c.disc, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 120 * k, height: 120 * k, borderRadius: 60 * k, borderWidth: 9 * k, borderColor: c.discIcon, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 44 * k, height: 44 * k, borderRadius: 22 * k, backgroundColor: c.discIcon }} />
        </View>
      </View>
      <Brand k={k} fg={c.fg} bg={c.bg} />
      <View style={{ position: 'absolute', left: 24 * k, right: 24 * k, top: 355 * k, gap: 10 * k, alignItems: 'center' }}>
        <Text style={tx(k, 14, c.kicker, { fontWeight: '800', letterSpacing: 1.4 * k })}>YOUR RIDE PERSONALITY</Text>
        <Text numberOfLines={2} adjustsFontSizeToFit style={tx(k, 40, c.fg, { fontWeight: '900', textAlign: 'center', lineHeight: 44 * k })}>{d.persona.title}</Text>
        <Text numberOfLines={3} style={tx(k, 17, c.sub, { textAlign: 'center', lineHeight: 24 * k, maxWidth: 290 * k })}>{d.persona.line}</Text>
      </View>
    </View>
  );
}

function WrapSummary({ k, c, d }) {
  const tiles = [[String(d.rides), 'rides'], [`${d.dist} ${d.distUnit}`, 'walked'], [d.queueLabel, 'queuing'], [String(d.snackTotal), 'snacks']];
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, padding: 24 * k, gap: 14 * k }}>
      <View style={{ gap: 2 * k, marginTop: 8 * k }}>
        <Text style={tx(k, 13, c.kicker, { fontWeight: '800', letterSpacing: 1 * k })}>{d.dateLabel}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={tx(k, 32, c.fg, { fontWeight: '900', letterSpacing: -0.5 * k })}>{`My ${d.resortShort} Day`}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 * k }}>
        {tiles.map(([v, label], i) => (
          <View key={label} style={{ width: 151 * k, borderRadius: 16 * k, padding: 14 * k, backgroundColor: c.tiles[i][0] }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={tx(k, 32, c.tiles[i][1], { fontWeight: '900' })}>{v}</Text>
            <Text style={tx(k, 13, c.tiles[i][1], { fontWeight: '800' })}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: c.panel, borderRadius: 16 * k, padding: 14 * k, gap: 6 * k }}>
        {[['Top ride', d.topRide ? `${d.topRide.name} ×${d.topRide.n}` : '—'],
          ['Top snack', d.snacks[0] ? `${d.snacks[0].name} ×${d.snacks[0].n}` : '—'],
          ['Personality', d.persona.short]].map(([label, v]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 * k }}>
            <Text style={tx(k, 14, c.mute)}>{label}</Text>
            <Text numberOfLines={1} style={tx(k, 14, c.fg, { fontWeight: '800', flexShrink: 1, textAlign: 'right' })}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 'auto', backgroundColor: c.foot, borderRadius: 16 * k, paddingVertical: 16 * k, paddingHorizontal: 16 * k,
        alignItems: 'center', gap: 4 * k }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 * k }}>
          <View style={{ width: 40 * k, height: 40 * k, borderRadius: 20 * k, backgroundColor: c.footIcon, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: c.foot, fontSize: 24 * k, fontWeight: '900', lineHeight: 26 * k }}>→</Text>
          </View>
          <Text style={tx(k, 30, c.footFg, { fontWeight: '900', letterSpacing: -0.8 * k })}>Ride Next</Text>
        </View>
        <Text style={tx(k, 13, c.footSub, { fontWeight: '600' })}>Less queuing, more riding.</Text>
      </View>
    </View>
  );
}

const WRAP_COMPONENTS = { open: WrapOpen, rides: WrapRides, queue: WrapQueue, walk: WrapWalk, snacks: WrapSnacks, persona: WrapPersona, summary: WrapSummary };

// Branded loading screen: the Admit One ticket in Coral sunset (design L on the canvas)
const BRAND = { bg: '#FF7A5C', ticket: '#FFF4E6', plum: '#3B1F2B', admit: '#A63A2B', peach: '#FFB4A2' };
function LoadingScreen({ message = 'Checking live waits' }) {
  const { width, height } = useWindowDimensions();
  const stars = [{ x: 0.15, y: 0.2, r: 3, col: BRAND.ticket }, { x: 0.85, y: 0.15, r: 2, col: BRAND.plum }, { x: 0.9, y: 0.7, r: 3, col: BRAND.ticket },
    { x: 0.09, y: 0.73, r: 2, col: BRAND.plum }];
  return (
    <View style={{ flex: 1, backgroundColor: BRAND.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}
      accessibilityLabel={`Ride Next. ${message}`}>
      <StatusBar style="dark" />
      {stars.map((st, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', left: st.x * width - st.r, top: st.y * height - st.r,
          width: st.r * 2, height: st.r * 2, borderRadius: st.r, backgroundColor: st.col }} />
      ))}
      <View style={{ alignItems: 'center', gap: 30, marginTop: -40 }}>
        <View style={{ width: 310, height: 176, borderRadius: 16, backgroundColor: BRAND.ticket, flexDirection: 'row', overflow: 'hidden' }}>
          <View style={{ flex: 1, paddingLeft: 30, justifyContent: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 2.4, color: BRAND.admit }}>ADMIT ONE</Text>
            <Text style={{ fontSize: 58, fontWeight: '900', letterSpacing: -1.5, lineHeight: 54, color: BRAND.plum }}>{'RIDE\nNEXT'}</Text>
          </View>
          <View style={{ width: 3, paddingVertical: 10, justifyContent: 'space-between' }}>
            {Array.from({ length: 12 }, (_, i) => <View key={i} style={{ width: 3, height: 7, borderRadius: 1.5, backgroundColor: BRAND.peach }} />)}
          </View>
          <View style={{ width: 75, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: BRAND.plum, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-forward" size={28} color={BRAND.bg} />
            </View>
          </View>
          <View style={{ position: 'absolute', left: -16, top: 72, width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND.bg }} />
          <View style={{ position: 'absolute', right: -16, top: 72, width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND.bg }} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '600', color: BRAND.plum }}>Less queuing, more riding.</Text>
      </View>
      <View style={{ position: 'absolute', left: 24, right: 24, bottom: 72, alignItems: 'center', gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[BRAND.ticket, BRAND.peach, BRAND.plum].map((col) => <View key={col} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: col }} />)}
        </View>
        <Text style={{ fontSize: 13, fontWeight: '600', color: BRAND.plum, textAlign: 'center' }}>{message}</Text>
      </View>
    </View>
  );
}

// Crowd level out of 10, as a 10-step meter
const CROWD_COLOURS = ['#15803D', '#15803D', '#15803D', '#CA8A04', '#CA8A04', '#CA8A04', '#C2410C', '#C2410C', '#B91C1C', '#B91C1C'];
function CrowdMeter({ c, compact = false }) {
  const col = CROWD_COLOURS[c.level - 1];
  return (
    <View style={{ gap: compact ? 4 : 6 }} accessibilityLabel={`Crowd level ${c.level} out of 10, ${c.label}. ${c.vsUsual || ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: compact ? 14 : 16, fontWeight: '800', color: C.ink }}>
          Crowd level <Text style={{ color: col }}>{c.level}/10</Text> · {c.label}
        </Text>
        {compact ? null : <Text style={s.mutedSmall}>avg wait {c.avg} min</Text>}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <View key={i} style={{ flex: 1, height: compact ? 6 : 8, borderRadius: 4, backgroundColor: i < c.level ? col : '#E2E8F0' }} />
        ))}
      </View>
      {c.vsUsual ? <Text style={[s.mutedSmall, { color: C.ink, fontWeight: '600' }]}>{c.vsUsual}</Text> : null}
      {compact ? null : <Text style={s.body}>{c.tip}</Text>}
      {compact ? null : <Text style={s.mutedSmall}>An estimate from live wait times. Disney doesn't publish park attendance.</Text>}
    </View>
  );
}

// − 2 + counter used on the Day Recap
function Counter({ n, label, onMinus, onPlus }) {
  const btn = { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable onPress={onMinus} style={btn} accessibilityRole="button" accessibilityLabel={`One less ${label}`} hitSlop={4}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink, lineHeight: 22 }}>−</Text>
      </Pressable>
      <Text style={{ minWidth: 22, textAlign: 'center', fontSize: 16, fontWeight: '800', color: C.ink }} accessibilityLabel={`${n} times`}>{n}</Text>
      <Pressable onPress={onPlus} style={btn} accessibilityRole="button" accessibilityLabel={`One more ${label}`} hitSlop={4}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: C.ink, lineHeight: 22 }}>+</Text>
      </Pressable>
    </View>
  );
}

// Two-tone icons from Expo's built-in icon set: a filled icon in the soft colour under an outline in the dark colour
const ICONS = { pin: 'location', map: 'map', food: 'restaurant', bell: 'notifications', walk: 'walk' };
const ICON_TONES = {
  orange: { line: C.accent, fill: C.accentSoft, bg: '#FFF4E8' },
  blue: { line: C.blue, fill: '#BFDBFE', bg: '#EFF6FF' },
  white: { line: '#FFFFFF', fill: 'rgba(255,255,255,0.35)', bg: 'transparent' },
};
function Icon({ name, size = 22, tone = 'orange' }) {
  const t = ICON_TONES[tone] || ICON_TONES.orange;
  const base = ICONS[name] || 'ellipse';
  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name={base} size={size} color={t.fill} style={{ position: 'absolute', left: 0, top: 0 }} />
      <Ionicons name={`${base}-outline`} size={size} color={t.line} style={{ position: 'absolute', left: 0, top: 0 }} />
    </View>
  );
}
function IconBadge({ name, tone = 'orange', size = 46 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: (ICON_TONES[tone] || ICON_TONES.orange).bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.6} tone={tone} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  welcome: { flex: 1, backgroundColor: C.dark },
  welcomeInner: { flexGrow: 1, justifyContent: 'space-between', padding: 24, paddingTop: 48, gap: 40 },
  welcomeKicker: { color: C.accentSoft, fontSize: 13, fontWeight: '700', letterSpacing: 1.5 },
  welcomeTitle: { color: '#fff', fontSize: 48, fontWeight: '800', letterSpacing: -1 },
  welcomeTag: { color: '#CBD5E1', fontSize: 20, fontWeight: '500' },
  stepRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: C.dark2, borderRadius: 16, padding: 16 },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: C.dark, fontWeight: '800', fontSize: 15 },
  stepTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  stepBody: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, marginTop: 2 },
  parkCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 10 },
  parkCardTitle: { color: C.ink, fontSize: 20, fontWeight: '800', flex: 1 },
  parkCardArrow: { color: C.ink, fontSize: 28, fontWeight: '600' },
  parkCardMeta: { color: C.muted, fontSize: 14 },
  resetBtn: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1' },
  resetBtnText: { color: C.red, fontSize: 14, fontWeight: '600' },
  cityName: { color: C.ink, fontSize: 26, fontWeight: '800' },
  changeBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#475569', justifyContent: 'center' },
  changeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  ghostBtnDark: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#475569', alignItems: 'center', justifyContent: 'center' },
  welcomeSmall: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 4 },
  header: { backgroundColor: C.card, padding: 20, paddingTop: 12, borderBottomWidth: 1, borderColor: C.line, gap: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  pad: { padding: 16, gap: 10, paddingBottom: 40 },
  footer: { backgroundColor: C.card, padding: 16, borderTopWidth: 1, borderColor: C.line, gap: 12 },
  h1: { fontSize: 28, fontWeight: '800', color: C.ink },
  h3: { fontSize: 16, fontWeight: '700', color: C.ink, marginBottom: 6 },
  big: { fontSize: 18, fontWeight: '600', color: C.ink, marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 21, color: C.ink },
  muted: { fontSize: 15, color: C.muted },
  mutedSmall: { fontSize: 13, color: C.muted },
  kicker: { fontSize: 13, fontWeight: '700', color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  errorText: { color: C.red, fontSize: 15, textAlign: 'center' },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, gap: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: C.ink },
  rowWait: { fontSize: 18, fontWeight: '700', color: C.ink },
  rowWaitSmall: { fontSize: 15, fontWeight: '600', color: '#334155' },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#94A3B8', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.dark, borderColor: C.dark },
  hero: { backgroundColor: C.dark, borderRadius: 22, padding: 20, gap: 12 },
  heroKicker: { color: C.accentSoft, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '800' },
  heroBody: { color: '#E2E8F0', fontSize: 15, lineHeight: 21 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { backgroundColor: C.dark2, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minWidth: 92 },
  statLabel: { color: '#CBD5E1', fontSize: 12 },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  btnLight: { minHeight: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnLightText: { color: C.ink, fontSize: 16, fontWeight: '800' },
  btnOutlineDark: { minHeight: 52, width: 100, borderRadius: 14, borderWidth: 1, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  btnOutlineDarkText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDark: { minHeight: 56, borderRadius: 16, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  btnDarkText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  ghostBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: C.card, justifyContent: 'center' },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: C.ink },
  listBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  listBtnText: { fontSize: 15, fontWeight: '700', color: C.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', justifyContent: 'center', backgroundColor: '#fff' },
  chipText: { fontSize: 14, fontWeight: '600', color: C.ink },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8 },
  linkBtn: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.blue, justifyContent: 'center' },
  linkBtnText: { color: C.blue, fontSize: 13, fontWeight: '700' },
  landHeader: { fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 10, marginBottom: 2, letterSpacing: 0.3 },
  toggle: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 10, padding: 2, gap: 2 },
  toggleBtn: { minHeight: 36, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center' },
  toggleBtnOn: { backgroundColor: C.dark },
  toggleText: { fontSize: 13, fontWeight: '700', color: C.ink },
  extreme: { flex: 1, borderRadius: 12, padding: 12, gap: 2 },
  extremeValue: { fontSize: 22, fontWeight: '800', color: C.ink },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 6, borderRadius: 8 },
  chipOn: { backgroundColor: C.dark, borderColor: C.dark },
  banner: { backgroundColor: C.green, borderRadius: 14, padding: 14, gap: 4 },
  bannerText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  bannerClose: { color: '#DCFCE7', fontSize: 12 },
  recapLink: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.dark2, borderRadius: 18, padding: 18, minHeight: 64 },
  recapLinkTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  recapLinkMeta: { color: '#CBD5E1', fontSize: 14, marginTop: 2 },
  recapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  listLine: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderBottomWidth: 1, borderColor: C.line },
  tag: { backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { fontSize: 13, fontWeight: '600', color: C.ink },
  ghostBtnWide: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1, borderColor: C.line },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counterBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  counterBtnText: { fontSize: 22, fontWeight: '700', color: C.ink },
  counterValue: { minWidth: 24, textAlign: 'center', fontSize: 18, fontWeight: '800', color: C.ink },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: C.ink, backgroundColor: '#fff' },
  addBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.dark, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  smallBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', justifyContent: 'center' },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: C.ink },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 13, fontWeight: '700' },
});

// Root: gives every screen the phone's safe edges (notch, home bar, foldables)
export default function App() {
  return (
    <SafeAreaProvider>
      <RideNext />
    </SafeAreaProvider>
  );
}
