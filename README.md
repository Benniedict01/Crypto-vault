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

The watch-only monitor supports native-balance tracking on the following networks out of the box:

- Ethereum
- Base
- Arbitrum One
- Optimism
- Polygon
- BNB Smart Chain
- Avalanche C-Chain
- Gnosis
- Fantom
- Linea
- Scroll
- zkSync Era
- Mantle
- Celo
- Cronos
- opBNB
- Moonbeam
- Moonriver
- Metis
- Blast
- Mode
- Taiko
- Sei EVM
- Berachain
- Ink
- Sonic
- Solana
- Bitcoin

For EVM networks, the same `0x...` public address can be monitored on multiple chains because the address format is shared; balances remain chain-specific. Solana and Bitcoin require their own native addresses.

### Adding another EVM chain

No new balance algorithm is required. Add the network to `EVM_CHAINS` in `chains.js` with its public RPC URL, native symbol, and chain name.

### Adding a non-EVM chain

Add a dedicated adapter to `chains.js` and register it in `ADAPTERS`. The adapter should return `{ chain, symbol, amount }`. Add the asset's CoinGecko ID to `COINGECKO_IDS` in `server.js` if USD pricing is desired.

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
