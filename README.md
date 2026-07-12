# Regicide

A digital version of the cooperative card game [Regicide](https://www.regicidegame.com/), playable with up to 4 players over the internet.

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
npm test -w packages/shared        # game engine scenario tests (vitest)
npm test -w packages/server        # server/socket integration test
```

## Deploying (Render, free tier)

1. Push this repo to a GitHub repo you own.
2. In Render, "New +" → "Blueprint", point it at the repo — `render.yaml` at the root configures the service automatically (build: `npm install && npm run build`, start: `npm start`).
3. Once deployed, Render gives you a public URL — that's what you share with friends.
4. Free tier note: the service spins down after ~15 minutes idle and takes ~30-50s to wake back up on the next request. Fine for a "give it a minute" game night, just a heads up.

There's no database and no auth — game state lives in memory, so a server restart mid-game loses that game. Rooms are private by a 4-character code only (not listed anywhere), which is enough for sharing with friends directly.
