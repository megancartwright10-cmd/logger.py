// Ride Next — version 2 (Disneyland Resort)
// Live waits: ThemeParks.wiki (free, unofficial). History + restaurants: your GitHub repo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, RefreshControl, SafeAreaView,
  ScrollView, Share, StyleSheet, Switch, Text, TextInput, Vibration, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Pedometer } from 'expo-sensors';

const DATA_URL = 'https://raw.githubusercontent.com/megancartwright10-cmd/logger.py/main/data/app/disneyland-resort.json';
const LIVE_URL = (id) => `https://api.themeparks.wiki/v1/entity/${id}/live`;
const SCHEDULE_URL = (id) => `https://api.themeparks.wiki/v1/entity/${id}/schedule`;
const DINING_URL = 'https://disneyland.disney.go.com/dining/';
const STORE_KEY = 'ridenext:v1';
const REFRESH_MS = 3 * 60 * 1000;
const LL_WAIT = 10; // rough Lightning Lane wait, minutes
const FAST_REFRESH_MS = 60 * 1000; // while a ride you care about is down
const HOP_MIN = 12; // rough walk between the two parks, minutes
const MULTI_PASS_GAP_MIN = 120; // Disney: book again after using it, or 2 hours after booking
const HEIGHT_OPTIONS = [null, 32, 35, 38, 40, 42, 46, 48];

// Rides people rush to at opening, in rough priority order (used when there's no history yet)
const HEADLINERS = {
  'Disneyland Park': ['Star Wars: Rise of the Resistance', 'Space Mountain', 'Indiana Jones™ Adventure',
    "Mickey & Minnie's Runaway Railway", "Tiana's Bayou Adventure", 'Matterhorn Bobsleds', "Peter Pan's Flight",
    'Millennium Falcon: Smugglers Run', 'Big Thunder Mountain Railroad'],
  'Disney California Adventure Park': ['Radiator Springs Racers', 'WEB SLINGERS: A Spider-Man Adventure',
    'Guardians of the Galaxy - Mission: BREAKOUT!', 'Incredicoaster', 'Toy Story Midway Mania!',
    'Soarin’ Across America', 'Grizzly River Run'],
};

// Most popular things people order. Menus change, so people can add their own too.
const SNACKS = {
  'Disneyland Park': [
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
  'Disney California Adventure Park': [
    { id: 'churro', name: 'Churro', where: 'Carts and Cozy Cone Motel' },
    { id: 'cozy-cone', name: 'Cozy Cone treat', where: 'Cozy Cone Motel' },
    { id: 'corn-dog', name: 'Corn dog', where: 'Corn Dog Castle' },
    { id: 'lobster-nachos', name: 'Lobster nachos', where: 'Lamplight Lounge' },
    { id: 'pym', name: 'Something giant (or tiny)', where: 'Pym Test Kitchen' },
    { id: 'ice-cream', name: 'Ice cream', where: "Clarabelle's" },
    { id: 'smoothie', name: 'Smoothie', where: 'Schmoozies!' },
    { id: 'popcorn', name: 'Popcorn', where: 'Popcorn carts' },
  ],
};
const STEP_MILES = 0.000473; // average stride ~2.5 ft

// ---------- notifications ----------
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
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
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
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
const shortPark = (name) => (name || '').replace('Disney California Adventure Park', 'California Adventure').replace(' Park', '');
const clockFromMs = (ms, offsetMin) => {
  const d = new Date(ms + offsetMin * 60000);
  return fmtTime(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
};
const BIG_SHOW = /firework|parade|world of color|fantasmic|nighttime|spectacular|believe/i;

// Rope drop: which picks gain the most wait between opening and midday?
function ropeDropPicks(rides, openHour, parkName) {
  const head = HEADLINERS[parkName] || [];
  const scored = rides.map((r) => {
    const curve = r.typical && (r.typical.weekday || r.typical.weekend);
    let gain = null;
    if (curve && curve[openHour] != null) {
      const later = [1, 2, 3, 4].map((i) => curve[openHour + i]).filter((v) => v != null);
      if (later.length) gain = Math.max(...later) - curve[openHour];
    }
    const h = head.indexOf(r.name);
    return { r, gain, rank: h === -1 ? 99 : h };
  });
  scored.sort((a, b) => {
    if (a.gain != null && b.gain != null) return b.gain - a.gain;
    if (a.gain != null) return -1;
    if (b.gain != null) return 1;
    return a.rank - b.rank;
  });
  return scored.filter((x) => x.gain != null || x.rank < 99).slice(0, 3).map((x) => x.r);
}

function fmtHour(h) {
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
function outlook(ride, now, liveWait) {
  const typ = typicalFor(ride, now.dow, now.dayType);
  if (!typ) return { trend: 'unknown' };
  const cur = typ[now.hour] != null ? typ[now.hour] : liveWait;
  const next = [1, 2, 3].map((i) => typ[now.hour + i]).filter((v) => v != null);
  let best = null;
  for (let h = now.hour + 1; h < 24; h++) {
    if (typ[h] != null && (!best || typ[h] < best.wait)) best = { hour: h, wait: typ[h] };
  }
  if (cur == null || next.length === 0) return { trend: 'unknown', best };
  const later = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
  const diff = later - cur;
  const trend = diff >= 8 ? 'up' : diff <= -8 ? 'down' : 'steady';
  return { trend, later, diff, best };
}

function lightningLane(live, look) {
  const now = live.wait != null ? live.wait : null;
  const ref = [now, look.best ? look.best.wait : null].filter((v) => v != null);
  const bestStandby = ref.length ? Math.min(...ref) : null;
  const saved = bestStandby != null ? Math.max(0, bestStandby - LL_WAIT) : null;
  const when = look.best && look.best.wait === bestStandby ? ` around ${fmtHour(look.best.hour)}` : ' right now';

  if (live.single && live.single.state === 'AVAILABLE') {
    const price = live.single.price;
    if (saved == null) return { verdict: 'Maybe', tone: 'amber', body: 'Single Pass is on sale, but there isn\'t enough wait data to judge it yet.', price };
    if (saved < 15) return { verdict: 'Skip it', tone: 'grey', body: `The standby line is about ${bestStandby} min${when}. Ride standby and keep your money.`, price };
    const perHour = price ? ` That's about $${Math.round((price * 60) / saved)} for every hour saved.` : '';
    if (saved >= 30) return { verdict: 'Worth it', tone: 'green', body: `Even at its best today, standby is about ${bestStandby} min. Single Pass saves you roughly ${saved} min.${perHour}`, price };
    return { verdict: 'Maybe', tone: 'amber', body: `Saves about ${saved} min compared with standby${when}.${perHour} Worth it if your day is packed.`, price };
  }
  if (live.multi === 'AVAILABLE') {
    if (saved != null && saved >= 15) return { verdict: 'Use it', tone: 'green', body: `If you have Lightning Lane Multi Pass, book this one: it saves about ${saved} min.` };
    return { verdict: 'Save it', tone: 'grey', body: `This ride is part of Multi Pass, but standby is short${when}. Use your booking on a busier ride.` };
  }
  if ((live.single && live.single.state === 'FINISHED') || live.multi === 'FINISHED') {
    return { verdict: 'Sold out', tone: 'grey', body: 'Lightning Lane for this ride has run out for today.' };
  }
  return { verdict: 'Not offered', tone: 'grey', body: 'No Lightning Lane for this ride right now.' };
}

const TONES = {
  green: { bg: '#DCFCE7', fg: '#14532D' }, amber: { bg: '#FEF3C7', fg: '#78350F' }, grey: { bg: '#F1F5F9', fg: '#334155' },
};

// ---------- app ----------
export default function App() {
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
    minHeight: null, watch: [], customSnacks: [], log: {}, ll: null, reminders: {},
    snackCounts: {}, meals: {}, areas: {}, day: null, stepsAndroid: {}, waitAlerts: {}, ratings: {},
  });
  const [snacksOpen, setSnacksOpen] = useState(false);
  const [backTo, setBackTo] = useState('welcome');
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
  const loaded = useRef(false);

  const park = data ? data.parks[parkIdx] : null;
  const now = data ? parkNow(data.utcOffsetMinutes) : null;

  // load saved choices + static data
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((s) => { if (s) setSaved((prev) => ({ ...prev, ...JSON.parse(s) })); })
      .catch(() => {})
      .finally(() => { loaded.current = true; });
    fetch(DATA_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        d.parks.forEach((p) => p.rides.forEach((r) => { r.parkId = p.id; r.parkName = p.name; }));
        setData(d);
      })
      .catch((e) => setError(`Couldn't load park data (${e.message}).`));
  }, []);

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
      const watched = new Set([...(sv.watch || []), ...Object.values(sv.selected || {}).flat()]);
      const reopened = [...watched].filter((id) => {
        const before = prevLive.current[id], after = merged[id];
        return before && after && before.status === 'DOWN' && after.status === 'OPERATING';
      });
      if (reopened.length) {
        const names = reopened.map((id) => merged[id].name);
        Vibration.vibrate([0, 300, 150, 300]);
        setBanner(`It's back up! ${names.join(', ')} just reopened. Lines are short right now.`);
        names.forEach((n) => notifyNow("It's back up!", `${n} just reopened. Lines are short right now, head over!`));
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
  const tooTall = (r) => saved.minHeight != null && r.height != null && r.height > saved.minHeight;

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
  const bumpSnack = (id, delta) => setSaved((cur) => {
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
      minutes, stepCount, miles: Math.round(stepCount * STEP_MILES * 10) / 10, stepsPartial: !(steps && steps.whole),
      rides: todayLog.length, queue: queueToday,
      areas: [...visitedLands].filter((l) => allLands.has(l)), areaTotal: allLands.size,
      missed: [...allLands].filter((l) => !visitedLands.has(l)),
      snacks: snackList, meals: mealList,
    };
  }, [data, now && now.minute, day, steps, saved, todayLog, park]);

  const shareRecap = () => {
    if (!recap) return;
    const lines = ['My Disneyland Day ✨'];
    if (recap.minutes) lines.push(`${fmtDuration(recap.minutes)} in the park`);
    if (recap.miles) lines.push(`${recap.miles} miles walked`);
    lines.push(`${recap.rides} ride${recap.rides === 1 ? '' : 's'} · ${fmtDuration(recap.queue)} queuing`);
    if (recap.areaTotal) lines.push(`${recap.areas.length} of ${recap.areaTotal} areas visited`);
    recap.meals.forEach((m) => lines.push(`${m.name} ×${m.n}`));
    recap.snacks.forEach((x) => lines.push(`${x.name} ×${x.n}`));
    lines.push('Planned with Ride Next');
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  const resetPark = (p) => {
    setSaved((s) => ({
      ...s,
      selected: { ...s.selected, [p.id]: [] },
      done: Object.fromEntries(Object.entries(s.done).filter(([k]) => !k.endsWith(`:${p.id}`))),
      log: Object.fromEntries(Object.entries(s.log || {}).map(([d, list]) => [d, list.filter((x) => x.parkId !== p.id)])),
    }));
    setSkippedBy((k) => ({ ...k, [p.id]: [] }));
  };
  const confirmReset = (p) => Alert.alert(
    `Reset ${p.name}?`,
    'This clears the rides you picked and what you\'ve ridden today in this park.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: () => resetPark(p) }],
  );

  const toggleRide = (id) => setSaved((s) => {
    const cur = s.selected[park.id] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { ...s, selected: { ...s.selected, [park.id]: next } };
  });
  const markDone = (ride) => setSaved((s) => {
    // keep only today's done lists so storage stays small
    const key = `${now.dateKey}:${ride.parkId || park.id}`;
    const keep = Object.fromEntries(Object.entries(s.done).filter(([k]) => k.startsWith(now.dateKey)));
    const log = { [now.dateKey]: [...((s.log || {})[now.dateKey] || []),
      { id: ride.id, name: ride.name, parkId: ride.parkId, land: ride.land, wait: ride.posted ? ride.wait : 0, at: Date.now() }] };
    return { ...s, done: { ...keep, [key]: [...(keep[key] || []), ride.id] }, log };
  });

  const toggleWatch = async (id) => {
    const on = (saved.watch || []).includes(id);
    if (!on) await askNotifyPermission();
    setSaved((cur) => ({ ...cur, watch: on ? cur.watch.filter((x) => x !== id) : [...(cur.watch || []), id] }));
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
  const rateMeal = (name, stars) => setSaved((cur) => ({ ...cur, ratings: { ...(cur.ratings || {}), [name]: stars } }));
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
      const look = outlook(r, now, l.wait);
      const walk = saved.useLoc ? walkMinutes(coords, r.loc) : null;
      const otherPark = r.parkId !== park.id;
      let score = wait + (walk || 0) + (otherPark && walk == null ? HOP_MIN : 0);
      if (look.trend === 'up') score -= Math.min(15, Math.round(look.diff / 2));
      if (look.trend === 'down') score += Math.min(20, Math.round(-look.diff / 2));
      if (saved.rain && !r.indoor) score += 30;
      ranked.push({
        ...r, wait, standby, viaSingle: useSR, singleRider: l.singleRider, posted: l.wait != null,
        look, walk, otherPark, score, multi: l.multi, multiReturn: l.multiReturn,
      });
    });
    ranked.sort((a, b) => {
      const sa = allSkipped.indexOf(a.id), sb = allSkipped.indexOf(b.id);
      if (sa !== sb) { if (sa === -1) return -1; if (sb === -1) return 1; return sa - sb; }
      return a.score - b.score;
    });
    const parkClosed = rides.length > 0 && down.length === rides.length && down.every((d) => d.status === 'CLOSED');
    return { ranked, down, parkClosed };
  }, [park, data, now && now.hour, live, saved, skippedBy, coords]);

  // ---------- render ----------
  if (screen === 'welcome') {
    const ready = !!data;
    const anyToday = ready && (todayLog.length > 0 || !!day);
    return (
      <SafeAreaView style={s.welcome}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={s.welcomeInner}>
          <View style={{ gap: 10 }}>
            <Text style={s.welcomeKicker}>DISNEYLAND RESORT</Text>
            <Text style={s.welcomeTitle}>Ride Next</Text>
            <Text style={s.welcomeTag}>Less queuing, more riding.</Text>
          </View>

          <View style={{ gap: 14 }}>
            {[
              ['1', 'Pick your rides', 'Tick everything you want to do today.'],
              ['2', 'We tell you what to ride next', 'Live waits, Single Rider, walking time, and whether the line will get worse later.'],
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
            <Text style={s.welcomeSmall}>Unofficial app. Not affiliated with or endorsed by Disney. Wait times are estimates.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={s.center}>
        {error ? <Text style={s.errorText}>{error}</Text> : <ActivityIndicator size="large" color={C.ink} />}
      </SafeAreaView>
    );
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

  // ----- Day Recap -----
  if (screen === 'recap') {
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
            <Text style={s.heroKicker}>MY DISNEYLAND DAY · {DAY_NAMES[now.dow].toUpperCase()}</Text>
            <View style={s.recapGrid}>
              <Stat label="In the park" value={r.minutes ? fmtDuration(r.minutes) : '—'} />
              <Stat label="Walked" value={r.miles ? `${r.miles} mi` : '—'} />
              <Stat label="Rides" value={String(r.rides)} />
              <Stat label="Queuing" value={fmtDuration(r.queue)} />
            </View>
            {r.areaTotal ? (
              <Text style={s.heroBody}>{r.areas.length} of {r.areaTotal} areas visited{r.missed.length && r.missed.length <= 3 ? `. You missed ${r.missed.join(', ')}!` : ''}</Text>
            ) : null}
            <Pressable style={s.btnLight} onPress={shareRecap} accessibilityRole="button">
              <Text style={s.btnLightText}>Share my day</Text>
            </Pressable>
            <Text style={{ color: '#94A3B8', fontSize: 12 }}>Tip: screenshot this card to share it as a picture.</Text>
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
              {r.stepsPartial && r.miles ? ' · on Android, steps only count while the app is open' : ''}
            </Text>
          )}

          {todayLog.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Rides</Text>
              {todayLog.map((x, i) => (
                <View key={`${x.id}-${i}`} style={s.listLine}>
                  <Text style={[s.body, { flex: 1 }]}>{x.name}</Text>
                  <Text style={s.mutedSmall}>{x.wait ? `${x.wait} min wait` : ''}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {r.areas.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Areas visited</Text>
              <View style={s.chips}>
                {r.areas.map((a) => <View key={a} style={s.tag}><Text style={s.tagText}>{a}</Text></View>)}
              </View>
            </View>
          ) : null}

          {r.meals.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Where you ate</Text>
              {r.meals.map((m) => (
                <View key={m.name} style={s.listLine}>
                  <Text style={[s.body, { flex: 1 }]}>{m.name} ×{m.n}</Text>
                  {(saved.ratings || {})[m.name] ? <Text style={s.mutedSmall}>{'★'.repeat(saved.ratings[m.name])}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {r.snacks.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Snacks</Text>
              {r.snacks.map((x) => (
                <View key={x.name} style={s.listLine}><Text style={s.body}>{x.name} ×{x.n}</Text></View>
              ))}
            </View>
          ) : null}

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
    const look = outlook(ride, now, l.wait);
    const typ = typicalFor(ride, now.dow, now.dayType);
    const hours = typ ? typ.map((v, h) => ({ v, h })).filter((x) => x.v != null) : [];
    const today = extremes(typ);
    const week = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const curve = ride.typical && ride.typical.dow && ride.typical.dow[d];
      const ex = curve && curve.filter((v) => v != null).length >= 4 ? extremes(curve) : null;
      return { d, ex };
    }).filter((x) => x.ex);
    const lastUpd = minutesAgo(l.updated);
    const max = Math.max(1, ...hours.map((x) => x.v));
    const ll = lightningLane(l, look);
    const tone = TONES[ll.tone];
    const target = alertFor(ride.id);
    const isDown = l.status === 'DOWN';
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
              <Text style={s.h3}>Temporarily down</Text>
              {onMyList(ride.id) ? (
                <Text style={s.body}>It's on your list, so we'll buzz you the moment it's back up.</Text>
              ) : (
                <>
                  <Text style={s.body}>Want a buzz the moment it reopens? Lines are short for a few minutes after.</Text>
                  <Pressable style={s.btnDark} onPress={() => toggleWatch(ride.id)} accessibilityRole="button">
                    <Text style={s.btnDarkText}>{(saved.watch || []).includes(ride.id) ? "Watching: we'll buzz you" : "Tell me when it's back up"}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}

          {ride.height ? (
            <View style={s.card}>
              <Text style={s.h3}>Height: {ride.height} in ({Math.round(ride.height * 2.54)} cm)</Text>
              <Text style={s.body}>
                Rider Switch: if someone in your group is too short, one adult waits with them while the others ride,
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
            {hours.length === 0 ? (
              <Text style={s.muted}>Not enough history yet. This fills in as your logger collects data over the next few days.</Text>
            ) : (
              <>
                <View style={s.chart} accessibilityLabel="Bar chart of typical waits by hour">
                  {hours.map((x) => (
                    <View key={x.h} style={s.barCol}>
                      <View style={[s.bar, { height: Math.max(3, Math.round((x.v / max) * 120)), backgroundColor: x.h === now.hour ? C.accent : '#CBD5E1' }]} />
                    </View>
                  ))}
                </View>
                <View style={s.chartLabels}>
                  {hours.map((x) => (
                    <Text key={x.h} style={s.chartLabel}>{x.h % 3 === 0 ? fmtHour(x.h).replace('noon', '12p').replace('am', 'a').replace('pm', 'p') : ''}</Text>
                  ))}
                </View>
                <Text style={s.mutedSmall}>Orange = this hour</Text>
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

          {look.best ? (
            <View style={[s.card, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
              <Text style={s.kicker}>Best time later today</Text>
              <Text style={s.body}>Around {fmtHour(look.best.hour)}, usually about {look.best.wait} min</Text>
            </View>
          ) : null}

          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.h3}>Lightning Lane: worth it?</Text>
              <View style={[s.pill, { backgroundColor: tone.bg }]}><Text style={[s.pillText, { color: tone.fg }]}>{ll.verdict}</Text></View>
            </View>
            <Text style={s.body}>{ll.body}</Text>
            {ll.price ? <Text style={s.mutedSmall}>Single Pass price right now: ${ll.price} per person</Text> : null}
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
      ...(SNACKS[park.name] || []),
      ...(saved.customSnacks || []).map((x) => ({ ...x, where: 'Added by you', custom: true })),
    ];
    const snackTotal = Object.values(snackCountsToday).reduce((a, b) => a + b, 0);

    // rope drop: before opening, the first 45 minutes, or tonight for tomorrow
    const todayHours = hoursFor(park).main[0];
    const opensMin = todayHours ? toMin(todayHours[0]) : null;
    const closesMin = todayHours ? toMin(todayHours[1]) : null;
    let ropeDrop = null;
    const pool = (selected.length ? park.rides.filter((r) => selected.includes(r.id)) : park.rides).filter((r) => !tooTall(r));
    if (opensMin != null && now.minute < opensMin + 45 && !(closesMin != null && closesMin < opensMin && now.minute < closesMin)) {
      ropeDrop = { when: now.minute < opensMin ? 'today' : 'now', open: todayHours[0] };
    } else {
      const tomorrowKey = nextDateKey(now.dateKey);
      const tomorrow = hoursFor(park, tomorrowKey).main[0];
      const afterClose = !todayHours || (closesMin != null && closesMin > opensMin && now.minute >= closesMin);
      if (tomorrow && afterClose) ropeDrop = { when: 'tomorrow', open: tomorrow[0] };
    }
    if (ropeDrop) {
      const openHour = Math.floor(toMin(ropeDrop.open) / 60);
      ropeDrop.picks = ropeDropPicks(pool, openHour, park.name);
      ropeDrop.by = fmtHour(openHour + 2);
      if (!ropeDrop.picks.length) ropeDrop = null;
    }

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
    ];

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
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <Text style={s.mutedSmall}>{saved.hopper ? 'Both parks' : park.name} · {hoursLine(park)} · {updatedText}</Text>

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

          {ropeDrop ? (
            <View style={[s.card, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
              <Text style={s.kicker}>Rope drop plan{ropeDrop.when === 'tomorrow' ? ' for tomorrow' : ''}</Text>
              <Text style={s.body}>
                {ropeDrop.when === 'now' ? 'The park just opened. ' : `Opens ${fmtTime(ropeDrop.open)}${ropeDrop.when === 'tomorrow' ? ' tomorrow' : ''}. `}
                Head to {ropeDrop.picks[0].name} first
                {ropeDrop.picks[1] ? `, then ${ropeDrop.picks[1].name}` : ''}
                {ropeDrop.picks[2] ? `, then ${ropeDrop.picks[2].name}` : ''} before {ropeDrop.by}.
              </Text>
              <Text style={s.mutedSmall}>These lines grow fastest after opening, so they're worth doing first.</Text>
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
                {top.look.later != null ? <Stat label="Next few hours" value={`~${top.look.later} min`} /> : null}
                {top.walk != null ? <Stat label="Walk" value={`${top.walk} min`} /> : top.otherPark ? <Stat label="Walk" value={`~${HOP_MIN} min`} /> : null}
              </View>
              <Text style={s.heroBody}>{reasonFor(top, saved.rain)}</Text>
              {!saved.useSingle && top.singleRider != null && top.singleRider + 10 <= top.standby ? (
                <Text style={{ color: C.accentSoft, fontSize: 14 }}>Single Rider is only {top.singleRider} min here. Turn on Single Rider above to use it.</Text>
              ) : null}
              <View style={s.row}>
                <Pressable style={[s.btnLight, { flex: 1 }]} onPress={() => markDone(top)} accessibilityRole="button">
                  <Text style={s.btnLightText}>Done, ridden it</Text>
                </Pressable>
                <Pressable style={s.btnOutlineDark} onPress={() => skipRide(top)} accessibilityRole="button">
                  <Text style={s.btnOutlineDarkText}>Skip</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => openRide(top.id)} accessibilityRole="button" style={{ paddingVertical: 10 }}>
                <Text style={{ color: C.accentSoft, fontWeight: '600' }}>Wait pattern, alerts & Lightning Lane ›</Text>
              </Pressable>
            </View>
          ) : selected.length === 0 ? (
            <View style={s.card}><Text style={s.h3}>No rides picked yet</Text><Text style={s.muted}>Tap Edit list to choose what you want to ride.</Text></View>
          ) : (
            <View style={s.card}><Text style={s.h3}>You've done your whole list</Text><Text style={s.muted}>Add more from Edit list, or go find a snack.</Text></View>
          )}

          {saved.multiPass ? (
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
                <FoodRow key={f.id} f={f} ateCount={mealsToday[f.name] || 0} rating={(saved.ratings || {})[f.name]}
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
                    <FoodRow key={f.id} f={f} ateCount={mealsToday[f.name] || 0} rating={(saved.ratings || {})[f.name]}
                      onAte={() => ateHere(f)} onRate={(n) => rateMeal(f.name, n)}
                      sub={hoursToday(f) ? `Today ${hoursToday(f).map(fmtRange).join(', ')}` : null}
                      right={(
                        <Pressable style={s.linkBtn} onPress={() => Linking.openURL(DINING_URL)} accessibilityRole="link">
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
                return (
                  <View key={x.id} style={s.foodRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{x.name}</Text>
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
                  <TrendLabel trend={r.look.trend} />
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
                {r.status === 'DOWN' ? <Text style={s.mutedSmall}>We'll buzz you when it's back up</Text> : null}
              </View>
              <View style={[s.pill, { backgroundColor: C.redSoft }]}><Text style={[s.pillText, { color: C.red }]}>{r.status === 'REFURBISHMENT' ? 'Refurbishment' : 'Temporarily closed'}</Text></View>
            </Pressable>
          ))}
          {hiddenTall.length ? (
            <View style={s.card}>
              <Text style={s.h3}>Hidden for height</Text>
              <Text style={s.muted}>
                {hiddenTall.length} ride{hiddenTall.length === 1 ? '' : 's'} on your list {hiddenTall.length === 1 ? 'is' : 'are'} too tall for your shortest rider. With Rider Switch, the grown-ups can still ride. Tap one for details.
              </Text>
              {hiddenTall.map((r) => (
                <Pressable key={r.id} style={s.listLine} onPress={() => openRide(r.id)} accessibilityRole="button">
                  <Text style={[s.body, { flex: 1 }]}>{r.name}</Text>
                  <Text style={s.mutedSmall}>{r.height} in · Rider Switch</Text>
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
        <View style={s.card}>
          <Text style={s.h3}>Your day</Text>
          {[
            ['hopper', 'I have a Park Hopper', 'Suggest rides in both parks'],
            ['useSingle', 'Happy to ride Single Rider', 'Use it when it\'s quicker'],
            ['multiPass', 'I have Lightning Lane Multi Pass', 'Get tips on what to book and when'],
            ['rain', 'Rainy day mode', 'Put indoor rides first'],
          ].map(([key, title, sub]) => (
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
            {HEIGHT_OPTIONS.map((h) => {
              const on = saved.minHeight === h;
              return (
                <Pressable key={String(h)} onPress={() => setOpt('minHeight', h)} accessibilityRole="button"
                  accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipText, on && { color: '#fff' }]}>{h == null ? 'No limit' : `${h} in`}</Text>
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
                  {r.height ? <Text style={[s.mutedSmall, tall && { color: C.red }]}>{tall ? `Needs ${r.height} in · Rider Switch` : `${r.height} in`}</Text> : null}
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
        <Pressable style={s.rowBetween} onPress={() => toggleLoc(!saved.useLoc)}
          accessibilityRole="switch" accessibilityState={{ checked: !!saved.useLoc }} accessibilityLabel="Use my location">
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Use my location</Text>
            <Text style={s.mutedSmall}>Adds walking time and areas visited</Text>
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

function FoodRow({ f, ateCount, rating, onAte, onRate, right, sub }) {
  return (
    <View style={[s.foodRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{f.name}</Text>
          {f.fav ? <Text style={[s.mutedSmall, { color: C.accent, fontWeight: '600' }]}>★ Fan favourite · {f.fav}</Text> : null}
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
    r.otherPark ? `It's in ${shortPark(r.parkName)}, about a ${HOP_MIN}-minute walk.` : '',
  ].filter(Boolean).join(' ');
  return `${reasonText(r, near)}${extra ? ` ${extra}` : ''}`;
}

function reasonText(r, near) {
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

function TrendLabel({ trend }) {
  const map = {
    up: ['↑ Worse later', C.accent], down: ['↓ Better later', C.blue],
    steady: ['→ Steady', C.muted], unknown: ['Not enough history yet', C.muted],
  };
  const [text, color] = map[trend] || map.unknown;
  return <Text style={{ color, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{text}</Text>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ground, padding: 24 },
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
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 3, borderBottomWidth: 1, borderColor: '#CBD5E1', marginTop: 6 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '80%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartLabels: { flexDirection: 'row', gap: 3 },
  chartLabel: { flex: 1, fontSize: 10, color: C.muted, textAlign: 'center' },
});
