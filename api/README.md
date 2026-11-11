# Ride Next guest stats API

A tiny server on Cloudflare's free tier. The app sends anonymous stats and shows the totals back:

- **Real queue times:** "I'm in the queue" → "On the ride!" in the app records the posted wait and how long the guest actually queued. Shown as "Ride Next guests actually wait about 32 min here", and used to rank rides.
- **Snacks:** counts from the snack tracker. Shown as "Most logged by guests this week". Guests' own custom snacks never leave their phone.
- **Restaurant ratings:** 1–5 stars, one per phone per restaurant, changeable. Shown as "4.6 ★ from 23 Ride Next guests".

## Privacy
- No names, emails, accounts or locations. Each phone sends a random ID made by the app, so the same guest isn't counted twice.
- Nothing is shown until at least 3 different phones (and 5 queues or ratings) contribute.
- Guests can switch it off in the app: **Share anonymous stats** on the set-up screen. Turning it off also deletes anything not yet sent.
- Waits that look impossible (a timer left running) are ignored; each phone can send at most 30 waits an hour.

## Endpoints
- `POST /v1/events` with `{ device, resort, events: [...] }` (`wait`, `snack` or `rating` events, max 50)
- `GET /v1/summary?resort=dlr|dlp|wdw` totals for the last 60 days (waits) and 7 days (snacks); cached 10 minutes
- `GET /v1/health`

## Deploying
The GitHub workflow **Deploy guest stats API** does everything (creates the database, the tables and the server, then writes the server address to `data/app/api.json`, which the app reads). It needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until they're added, it skips quietly.
