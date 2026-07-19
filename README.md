# Regicide

A digital version of the cooperative card game [Regicide](https://www.regicidegame.com/), playable with up to 4 players over the internet — plus **Regicide Legacy**, an original 12-mission campaign built on the same rules, with a permanently-growing party across four classes (Warrior/Bard/Cleric/Paladin). Pick either mode from the home screen.

## Local development

```
npm install
npm run build -w packages/shared   # shared package must be built before the server/client use it
npm run dev:server                 # starts the Socket.io/Express server on :3001
npm run dev:client                 # in another terminal: Vite dev server on :5173 (proxies to :3001)
```

Open `http://localhost:5173` in a couple of browser tabs (or your phone on the same wifi, using your laptop's LAN IP) to test with multiple players.

To run against a production-style single server instead:

```
npm run build
npm start                          # serves the built client + Socket.io from :3001 (or $PORT)
```

## Tests

```
npm test -w packages/shared        # game engine scenario tests, both rulesets (vitest)
npm test -w packages/server        # server/socket integration tests, both rulesets
```

## Deploying (Render, free tier)

1. Push this repo to a GitHub repo you own.
2. In Render, "New +" → "Blueprint", point it at the repo — `render.yaml` at the root configures the service automatically (build: `npm install && npm run build`, start: `npm start`).
3. Once deployed, Render gives you a public URL — that's what you share with friends.
4. Free tier note: the service spins down after ~15 minutes idle and takes ~30-50s to wake back up on the next request. Fine for a "give it a minute" game night, just a heads up.

There's no auth — rooms/campaigns are private by a code only (not listed anywhere), which is enough for sharing with friends directly.

### Regicide Legacy persistence (optional)

Classic Regicide has always been pure in-memory (a server restart mid-game loses that game — see the free-tier note above). Regicide Legacy campaigns are meant to be played over many sessions, so they *can* survive a restart if you wire up a database — but it's optional:

- **No `DATABASE_URL` set (default):** campaigns still work, but progress lives in memory only, same tradeoff as classic Regicide.
- **With `DATABASE_URL` set:** campaign progress (party roster, missions completed) persists in Postgres. Create a free database (e.g. a [Supabase](https://supabase.com) project — avoid Render's free Postgres, which auto-expires after 90 days), run `packages/server/schema.sql` against it once, then set `DATABASE_URL` as an env var (locally via `.env`, or in Render's dashboard / `render.yaml`).
