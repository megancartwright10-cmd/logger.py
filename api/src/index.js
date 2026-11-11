// Ride Next guest stats API (Cloudflare Worker + D1).
// POST /v1/events   the app sends anonymous waits, snacks and ratings in small batches
// GET  /v1/summary  totals the app shows back: fans' real waits, top snacks, fan ratings
// Nothing personal is stored: "device" is a random ID the app makes, and small groups are never shown.

const RESORTS = new Set(['dlr', 'dlp', 'wdw']);
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const DEVICE = /^[a-z0-9]{16,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_FANS = 3; // a number only shows once at least this many different phones contributed
const MIN_WAITS = 5;
const MIN_RATINGS = 5;
const WAIT_WINDOW_DAYS = 60;
const SNACK_WINDOW_DAYS = 7;
const MAX_EVENTS = 50;
const MAX_WAITS_PER_HOUR = 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });
}

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// Check one event and turn it into a database statement, or return null to skip it
export function statementFor(db, device, resort, e, now) {
  if (!e || typeof e !== 'object') return null;
  if (e.type === 'wait') {
    const posted = int(e.posted, 0, 300), actual = int(e.actual, 1, 300);
    if (posted == null || actual == null || !ID.test(e.parkId || '') || !ID.test(e.rideId || '')) return null;
    if (posted > 0 && actual > posted * 3 + 30) return null; // implausible (forgot to stop the timer)
    const dow = int(e.dow, 0, 6), hour = int(e.hour, 0, 23);
    return db.prepare('INSERT INTO waits (device, resort, park_id, ride_id, posted, actual, single_rider, dow, hour, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(device, resort, e.parkId, e.rideId, posted, actual, e.singleRider ? 1 : 0, dow, hour, now);
  }
  if (e.type === 'snack') {
    const n = int(e.n, 0, 20);
    if (n == null || !ID.test(e.parkId || '') || !ID.test(e.snack || '') || !DAY.test(e.day || '')) return null;
    if (String(e.snack).startsWith('custom-')) return null; // people's own snacks stay on their phone
    if (n === 0) return db.prepare('DELETE FROM snacks WHERE device = ? AND day = ? AND park_id = ? AND snack = ?').bind(device, e.day, e.parkId, e.snack);
    return db.prepare('INSERT INTO snacks (device, resort, park_id, snack, day, n, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (device, day, park_id, snack) DO UPDATE SET n = excluded.n, created = excluded.created')
      .bind(device, resort, e.parkId, e.snack, e.day, n, now);
  }
  if (e.type === 'rating') {
    const stars = int(e.stars, 0, 5);
    const place = typeof e.place === 'string' ? e.place.trim().slice(0, 120) : '';
    if (stars == null || !place) return null;
    if (stars === 0) return db.prepare('DELETE FROM ratings WHERE device = ? AND resort = ? AND place = ?').bind(device, resort, place);
    return db.prepare('INSERT INTO ratings (device, resort, place, stars, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (device, resort, place) DO UPDATE SET stars = excluded.stars, updated = excluded.updated')
      .bind(device, resort, place, stars, now);
  }
  return null;
}

export async function handleEvents(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const { device, resort, events } = body || {};
  if (!DEVICE.test(device || '') || !RESORTS.has(resort) || !Array.isArray(events)) return json({ error: 'bad request' }, 400);
  if (events.length > MAX_EVENTS) return json({ error: 'too many events' }, 413);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS c FROM waits WHERE device = ? AND created > ?').bind(device, now - 3600000).first();
  const waitsIn = events.filter((e) => e && e.type === 'wait').length;
  if (recent && recent.c + waitsIn > MAX_WAITS_PER_HOUR) return json({ error: 'slow down' }, 429);
  const stmts = events.map((e) => statementFor(env.DB, device, resort, e, now)).filter(Boolean);
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, saved: stmts.length, skipped: events.length - stmts.length });
}

export async function buildSummary(env, resort, now = Date.now()) {
  const since = now - WAIT_WINDOW_DAYS * 86400000;
  const snackSince = new Date(now - SNACK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const [w, sn, rt] = await env.DB.batch([
    env.DB.prepare(`SELECT ride_id, COUNT(*) AS n, COUNT(DISTINCT device) AS fans, AVG(posted) AS posted, AVG(actual) AS actual,
        AVG(CAST(actual AS REAL) / posted) AS ratio
      FROM waits WHERE resort = ? AND created > ? AND posted > 0 AND single_rider = 0
        AND CAST(actual AS REAL) / posted BETWEEN 0.1 AND 3
      GROUP BY ride_id HAVING fans >= ? AND n >= ?`).bind(resort, since, MIN_FANS, MIN_WAITS),
    env.DB.prepare(`SELECT park_id, snack, COUNT(DISTINCT device) AS fans, SUM(n) AS total
      FROM snacks WHERE resort = ? AND day >= ? GROUP BY park_id, snack HAVING fans >= ? ORDER BY fans DESC, total DESC`).bind(resort, snackSince, MIN_FANS),
    env.DB.prepare(`SELECT place, AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE resort = ? GROUP BY place HAVING n >= ?`).bind(resort, MIN_RATINGS),
  ]);
  const waits = {};
  (w.results || []).forEach((r) => {
    waits[r.ride_id] = { n: r.n, ratio: Math.round(r.ratio * 100) / 100, posted: Math.round(r.posted), actual: Math.round(r.actual) };
  });
  const snacks = {};
  (sn.results || []).forEach((r) => {
    const list = snacks[r.park_id] || (snacks[r.park_id] = []);
    if (list.length < 5) list.push({ snack: r.snack, fans: r.fans, total: r.total });
  });
  const ratings = {};
  (rt.results || []).forEach((r) => { ratings[r.place] = { avg: Math.round(r.avg * 10) / 10, n: r.n }; });
  return { resort, builtAt: new Date(now).toISOString(), waits, snacks, ratings };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (url.pathname === '/v1/events' && request.method === 'POST') return await handleEvents(request, env);
      if (url.pathname === '/v1/summary' && request.method === 'GET') {
        const resort = url.searchParams.get('resort');
        if (!RESORTS.has(resort)) return json({ error: 'unknown resort' }, 400);
        const cache = caches.default;
        const key = new Request(`${url.origin}/v1/summary?resort=${resort}`);
        const hit = await cache.match(key);
        if (hit) return hit;
        const res = json(await buildSummary(env, resort), 200, { 'Cache-Control': 'public, max-age=600' });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }
      if (url.pathname === '/' || url.pathname === '/v1/health') return json({ ok: true, service: 'ride-next-api' });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error' }, 500);
    }
  },
};
