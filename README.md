# Crypto Vault

Local, watch-only balance monitor. Tracks public addresses across
chains, emails you the moment funds arrive, serves a live dashboard
at `localhost:3000`. A companion mobile app (`crypto-vault-mobile`)
can also register for a push notification on the same event.

## Never reads keys or seed phrases

No field for one, no code path that reads one. A runtime guard
(`looksLikeSecret` in `server.js`) refuses to process an "address"
that looks like a BIP-39 phrase or a raw private key, in case one
gets pasted in by mistake.

This isn't a missing feature — watching a balance and noticing money
arrive only ever needs the **public** address. A key is only needed
to *spend*, and software that can read one is a much bigger target:
a bug, a stray log line, a leaked backup, or a compromised machine
turns "someone sees my balances" into "someone empties my wallet."
Real funds belong in a hardware wallet, not in software that reads
keys — same call made on your BIP-39 project.

## What actually leaves your machine

Fully offline isn't compatible with real-time value + email alerts —
both need to talk to something online. Here's exactly what goes out:

| Call | Sends | To |
|---|---|---|
| Balance check | your public address | chain RPC node / Blockstream |
| USD price | coin symbol only (e.g. "ETH") | CoinGecko |
| Alert email | label + amount | your SMTP provider |
| Alert push (optional) | label + amount | Expo's push service |

Nothing else, ever — no keys, no seed phrases. For transport privacy
too, run this on a box you control and point `rpcUrl` at your own
node instead of the public ones.

## Setup

1. `npm install`
2. `cp config.example.json config.json`, then fill in:
   - your addresses under `addresses`
   - `email` — for Gmail use an
     [App Password](https://myaccount.google.com/apppasswords), not
     your real password
3. `npm start` → dashboard at http://localhost:3000

It checks every address on `checkIntervalSeconds` (default 5 min),
emails on any balance increase (`minimumNotifyAmount: 0` = any
amount counts), and the dashboard auto-refreshes every 15s.

For something more permanent than a terminal window, run
`npm start` via `pm2`, a `systemd` service, or a `launchd` agent.

## Chains today

- **Ethereum** — plain JSON-RPC against a public node, no signup
- **Solana** — public JSON-RPC
- **Bitcoin** — Blockstream's public Esplora API (sums confirmed UTXOs)

## Adding chains

Another EVM chain (Polygon, Base, Arbitrum, ...) needs zero new
code — reuse the `ethereum` adapter with overrides:

```json
{ "label": "Polygon wallet", "chain": "ethereum", "address": "0x...",
  "rpcUrl": "https://polygon-rpc.com", "symbol": "MATIC", "chainName": "polygon" }
```

Anything else: add a function to `chains.js` returning
`{ chain, symbol, amount }`, and register it in `ADAPTERS`. Copy
`btcBalance` as a starting point if the chain is REST-based rather
than JSON-RPC.

Add the coin's id to `COINGECKO_IDS` in `server.js` to get its USD
price on the dashboard.

## Deploying it publicly

To get a real link (not just `localhost`), deploy `server.js` to a
host that runs a persistent Node process — Railway or Render both
fit well (unlike Vercel/Netlify, which run serverless functions and
won't keep `checkAll()`'s interval loop alive). Either way:

1. Attach a persistent volume/disk and set `DATA_DIR` to its mount
   path, so `state.json`/`push-tokens.json` survive restarts.
2. Set these as environment variables (all optional if the matching
   field is already in `config.json`, but secrets shouldn't be):
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TO`,
   and optionally `VAULT_ADDRESSES` (a JSON array, same shape as
   `config.json`'s `addresses`) if you'd rather not commit even that.
3. Set `ACCESS_TOKEN` to a long random string. Once set, every route
   requires it — `https://your-app.example.com/?token=...` for the
   dashboard, and an `X-Vault-Token` header for the API — so a
   stranger who finds the URL can't see your balances or register
   themselves for your push alerts. Leave it unset for local use;
   nothing is gated then, same as before.
4. `PORT` is provided by the host automatically — no need to set it.

## Mobile app

`crypto-vault-mobile` is a small Expo (React Native) app that shows
the same balances and registers this server's new
`/api/register-push-token` route so `checkAll()` can push an alert
to your phone alongside email. Its Settings screen has an optional
Access token field for once you've deployed with `ACCESS_TOKEN` set.
See its own README for setup — it's a separate project, not a
folder inside this one.

## Notes

- Public RPCs are free but rate-limited — fine for a handful of
  addresses on a 5-minute interval. Swap `rpcUrl` for a paid
  provider (Alchemy, Infura, ...) if you scale up.
- `config.json` and `state.json` hold your addresses and email
  credentials and are git-ignored by default — don't commit them.
- If you set `ACCESS_TOKEN`, treat it like a password — it's what
  stands between your deployed link and anyone who finds it.
