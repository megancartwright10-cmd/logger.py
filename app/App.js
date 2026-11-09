// Ride Next — version 1 (Disneyland Resort)
// Live waits: ThemeParks.wiki (free, unofficial). History + restaurants: your GitHub repo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const DATA_URL = 'https://raw.githubusercontent.com/megancartwright10-cmd/logger.py/main/data/app/disneyland-resort.json';
const LIVE_URL = (id) => `https://api.themeparks.wiki/v1/entity/${id}/live`;
const DINING_URL = 'https://disneyland.disney.go.com/dining/';
const STORE_KEY = 'ridenext:v1';
const REFRESH_MS = 3 * 60 * 1000;
const LL_WAIT = 10; // rough Lightning Lane wait, minutes

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
    dayType: day === 0 || day === 6 ? 'weekend' : 'weekday',
    dateKey: d.toISOString().slice(0, 10),
  };
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
      status: e.status,
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
  const typ = ride.typical && ride.typical[now.dayType];
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
  const [screen, setScreen] = useState('setup');
  const [detailId, setDetailId] = useState(null);
  const [saved, setSaved] = useState({ selected: {}, done: {}, useLoc: false });
  const [skipped, setSkipped] = useState([]);
  const [coords, setCoords] = useState(null);
  const [foodOpen, setFoodOpen] = useState(false);
  const [mood, setMood] = useState(null);
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
      .then(setData)
      .catch((e) => setError(`Couldn't load park data (${e.message}).`));
  }, []);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(STORE_KEY, JSON.stringify(saved)).catch(() => {});
  }, [saved]);

  const refreshLocation = useCallback(async () => {
    if (!saved.useLoc) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords([pos.coords.latitude, pos.coords.longitude]);
    } catch (e) { /* keep last known */ }
  }, [saved.useLoc]);

  const refreshLive = useCallback(async () => {
    if (!park) return;
    try {
      const r = await fetch(LIVE_URL(park.id));
      setLive(parseLive(await r.json()));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError('Couldn\'t get live wait times. Pull down to try again.');
    }
    refreshLocation();
  }, [park, refreshLocation]);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, REFRESH_MS);
    const clock = setInterval(() => setTick((n) => n + 1), 30000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [refreshLive]);

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

  const toggleRide = (id) => setSaved((s) => {
    const cur = s.selected[park.id] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { ...s, selected: { ...s.selected, [park.id]: next } };
  });
  const markDone = (id) => setSaved((s) => {
    // keep only today's done lists so storage stays small
    const keep = Object.fromEntries(Object.entries(s.done).filter(([k]) => k.startsWith(now.dateKey)));
    return { ...s, done: { ...keep, [doneKey]: [...(keep[doneKey] || []), id] } };
  });

  // ---------- ranking ----------
  const plan = useMemo(() => {
    if (!park || !now) return null;
    const rides = park.rides.filter((r) => selected.includes(r.id));
    const ranked = [], down = [];
    rides.forEach((r) => {
      const l = live[r.id] || {};
      if (done.includes(r.id)) return;
      if (l.status && l.status !== 'OPERATING') { down.push({ ...r, status: l.status }); return; }
      const wait = l.wait != null ? l.wait : 5;
      const look = outlook(r, now, l.wait);
      const walk = saved.useLoc ? walkMinutes(coords, r.loc) : null;
      let score = wait + (walk || 0);
      if (look.trend === 'up') score -= Math.min(15, Math.round(look.diff / 2));
      if (look.trend === 'down') score += Math.min(20, Math.round(-look.diff / 2));
      ranked.push({ ...r, wait, posted: l.wait != null, look, walk, score });
    });
    ranked.sort((a, b) => {
      const sa = skipped.indexOf(a.id), sb = skipped.indexOf(b.id);
      if (sa !== sb) { if (sa === -1) return -1; if (sb === -1) return 1; return sa - sb; }
      return a.score - b.score;
    });
    const parkClosed = rides.length > 0 && down.length === rides.length && down.every((d) => d.status === 'CLOSED');
    return { ranked, down, parkClosed };
  }, [park, now && now.hour, live, selected, done, skipped, coords, saved.useLoc]);

  // ---------- render ----------
  if (!data) {
    return (
      <SafeAreaView style={s.center}>
        {error ? <Text style={s.errorText}>{error}</Text> : <ActivityIndicator size="large" color={C.ink} />}
      </SafeAreaView>
    );
  }

  const updatedText = updatedAt ? `Updated ${Math.max(0, Math.round((Date.now() - updatedAt) / 60000))} min ago` : 'Loading live waits…';
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onPull} />;

  // ----- Ride detail -----
  if (screen === 'detail') {
    const ride = park.rides.find((r) => r.id === detailId);
    const l = live[ride.id] || {};
    const look = outlook(ride, now, l.wait);
    const typ = ride.typical && ride.typical[now.dayType];
    const hours = typ ? typ.map((v, h) => ({ v, h })).filter((x) => x.v != null) : [];
    const max = Math.max(1, ...hours.map((x) => x.v));
    const ll = lightningLane(l, look);
    const tone = TONES[ll.tone];
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.topBar}>
          <Pressable style={s.ghostBtn} onPress={() => setScreen('next')} accessibilityRole="button">
            <Text style={s.ghostBtnText}>‹ Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
          <Text style={s.h1}>{ride.name}</Text>
          <Text style={s.big}>{l.status && l.status !== 'OPERATING' ? 'Temporarily closed' : l.wait != null ? `${l.wait} min wait now` : 'No wait posted'}</Text>

          <View style={s.card}>
            <Text style={s.h3}>Typical {now.dayType} waits</Text>
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
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ----- Ride next -----
  if (screen === 'next') {
    const top = plan.ranked[0];
    const rest = plan.ranked.slice(1);
    const foodHere = park.food.filter((f) => !mood || f.moods.includes(mood));
    const moodsHere = Object.keys(MOOD_LABELS).filter((m) => park.food.some((f) => f.moods.includes(m)));
    const openFood = foodHere
      .filter((f) => f.service !== 'table')
      .filter((f) => { const st = (live[f.id] || {}).status; return !st || st === 'OPERATING'; })
      .map((f) => ({ ...f, walk: saved.useLoc ? walkMinutes(coords, f.loc) : null, known: !!(live[f.id] || {}).status }))
      .sort((a, b) => (a.walk != null && b.walk != null ? a.walk - b.walk : a.name.localeCompare(b.name)));
    const sitDown = foodHere.filter((f) => f.service === 'table');

    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <View style={s.topBar}>
          <Pressable style={s.ghostBtn} onPress={() => setScreen('setup')} accessibilityRole="button">
            <Text style={s.ghostBtnText}>Edit list</Text>
          </Pressable>
          <Text style={s.mutedSmall}>{updatedText}</Text>
        </View>
        <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          {plan.parkClosed ? (
            <View style={s.card}><Text style={s.h3}>The park looks closed right now</Text><Text style={s.muted}>Waits will appear here when it opens.</Text></View>
          ) : top ? (
            <View style={s.hero}>
              <Text style={s.heroKicker}>RIDE NEXT</Text>
              <Text style={s.heroTitle}>{top.name}</Text>
              <View style={s.statRow}>
                <Stat label="Wait now" value={top.posted ? `${top.wait} min` : 'No wait'} />
                {top.look.later != null ? <Stat label="Next few hours" value={`~${top.look.later} min`} /> : null}
                {top.walk != null ? <Stat label="Walk" value={`${top.walk} min`} /> : null}
              </View>
              <Text style={s.heroBody}>{reasonFor(top)}</Text>
              <View style={s.row}>
                <Pressable style={[s.btnLight, { flex: 1 }]} onPress={() => markDone(top.id)} accessibilityRole="button">
                  <Text style={s.btnLightText}>Done, ridden it</Text>
                </Pressable>
                <Pressable style={s.btnOutlineDark} onPress={() => setSkipped((k) => [...k.filter((x) => x !== top.id), top.id])} accessibilityRole="button">
                  <Text style={s.btnOutlineDarkText}>Skip</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => { setDetailId(top.id); setScreen('detail'); }} accessibilityRole="button" style={{ paddingVertical: 10 }}>
                <Text style={{ color: C.accentSoft, fontWeight: '600' }}>Wait pattern & Lightning Lane advice ›</Text>
              </Pressable>
            </View>
          ) : selected.length === 0 ? (
            <View style={s.card}><Text style={s.h3}>No rides picked yet</Text><Text style={s.muted}>Tap Edit list to choose what you want to ride.</Text></View>
          ) : (
            <View style={s.card}><Text style={s.h3}>You've done your whole list</Text><Text style={s.muted}>Add more from Edit list, or go find a snack.</Text></View>
          )}

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
                      style={[s.chip, on && { backgroundColor: C.dark, borderColor: C.dark }]}>
                      <Text style={[s.chipText, on && { color: '#fff' }]}>{MOOD_LABELS[m]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.kicker}>Quick bites{saved.useLoc ? ', closest first' : ''}</Text>
              {openFood.length === 0 ? <Text style={s.muted}>Nothing matching is open right now.</Text> : openFood.slice(0, 12).map((f) => (
                <View key={f.id} style={s.foodRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{f.name}</Text>
                    <Text style={s.mutedSmall}>{f.moods.map((m) => MOOD_LABELS[m]).join(' · ')}{f.service === 'snack' ? ' · snack stand' : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.mutedSmall, { color: f.known ? C.green : C.muted, fontWeight: '600' }]}>{f.known ? 'Open' : 'Hours not listed'}</Text>
                    {f.walk != null ? <Text style={s.mutedSmall}>{f.walk} min walk</Text> : null}
                  </View>
                </View>
              ))}
              {sitDown.length > 0 ? (
                <>
                  <Text style={[s.kicker, { marginTop: 12 }]}>Fancy a sit-down meal?</Text>
                  {sitDown.slice(0, 6).map((f) => (
                    <View key={f.id} style={s.foodRow}>
                      <Text style={[s.rowTitle, { flex: 1 }]}>{f.name}</Text>
                      <Pressable style={s.linkBtn} onPress={() => Linking.openURL(DINING_URL)} accessibilityRole="link">
                        <Text style={s.linkBtnText}>Check availability</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}
            </View>
          ) : null}

          {rest.length > 0 ? <Text style={s.kicker}>Rest of your list</Text> : null}
          {rest.map((r) => (
            <Pressable key={r.id} style={s.rideRow} onPress={() => { setDetailId(r.id); setScreen('detail'); }} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{r.name}</Text>
                <TrendLabel trend={r.look.trend} />
              </View>
              <Text style={s.rowWait}>{r.posted ? `${r.wait} min` : '—'}</Text>
            </Pressable>
          ))}
          {plan.down.map((r) => (
            <View key={r.id} style={s.rideRow}>
              <Text style={[s.rowTitle, { flex: 1, color: C.muted }]}>{r.name}</Text>
              <View style={[s.pill, { backgroundColor: C.redSoft }]}><Text style={[s.pillText, { color: C.red }]}>{r.status === 'REFURBISHMENT' ? 'Refurbishment' : 'Temporarily closed'}</Text></View>
            </View>
          ))}
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
        <Text style={s.kicker}>DISNEYLAND RESORT</Text>
        <Text style={s.h1}>Plan my day</Text>
        <View style={s.segment}>
          {data.parks.map((p, i) => (
            <Pressable key={p.id} onPress={() => { setParkIdx(i); setSkipped([]); }} accessibilityRole="button" accessibilityState={{ selected: i === parkIdx }}
              style={[s.segBtn, i === parkIdx && s.segBtnOn]}>
              <Text style={[s.segText, i === parkIdx && { color: '#fff' }]} numberOfLines={1}>{p.name.replace(' Park', '')}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.muted}>Tap the rides you want to do today.</Text>
      </View>
      <ScrollView contentContainerStyle={s.pad} refreshControl={refresh}>
        {park.rides.map((r) => {
          const on = selected.includes(r.id);
          const l = live[r.id] || {};
          const label = l.status && l.status !== 'OPERATING' ? 'Closed' : l.wait != null ? `${l.wait} min` : '';
          return (
            <Pressable key={r.id} style={s.rideRow} onPress={() => toggleRide(r.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <View style={[s.check, on && s.checkOn]}>{on ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}</View>
              <Text style={[s.rowTitle, { flex: 1 }]}>{r.name}</Text>
              <Text style={s.rowWaitSmall}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={s.footer}>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Use my location</Text>
            <Text style={s.mutedSmall}>Adds walking time to suggestions</Text>
          </View>
          <Switch value={saved.useLoc} onValueChange={toggleLoc} />
        </View>
        <Pressable style={[s.btnDark, selected.length === 0 && { opacity: 0.5 }]} disabled={selected.length === 0}
          onPress={() => { setSkipped([]); setScreen('next'); }} accessibilityRole="button">
          <Text style={s.btnDarkText}>Start my day · {selected.length} rides</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function reasonFor(r) {
  const near = r.walk != null && r.walk <= 6 ? ' and it\'s close by' : '';
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
  segment: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 12, padding: 3, gap: 3 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segBtnOn: { backgroundColor: C.dark },
  segText: { fontSize: 14, fontWeight: '600', color: C.ink },
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
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 13, fontWeight: '700' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 3, borderBottomWidth: 1, borderColor: '#CBD5E1', marginTop: 6 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '80%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartLabels: { flexDirection: 'row', gap: 3 },
  chartLabel: { flex: 1, fontSize: 10, color: C.muted, textAlign: 'center' },
});
