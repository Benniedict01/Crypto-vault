'use strict';
//
// Watch-only crypto balance monitor. Emails you (and/or pushes to
// your phone) when a tracked address's balance goes up, and serves
// a live dashboard - locally at http://localhost:PORT, or at a
// public URL once deployed.
//
// This never reads a private key or seed phrase - only public
// addresses. Checking a balance and noticing money arrive only
// ever needs the address; looksLikeSecret() below refuses to treat
// anything that looks like a seed phrase or private key as one, in
// case one gets pasted into the config by mistake.

const fs = require('fs');
const http = require('http');
const path = require('path');
const nodemailer = require('nodemailer');
const { ADAPTERS } = require('./chains');

const CONFIG_PATH = path.join(__dirname, 'config.json');
// DATA_DIR is where state.json/push-tokens.json live. Locally this
// is just the project folder; on a host with an ephemeral
// filesystem, point it at a mounted persistent volume instead
// (e.g. DATA_DIR=/data) so balances survive a restart.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const PUSH_TOKENS_PATH = path.join(DATA_DIR, 'push-tokens.json');

// Config comes from config.json locally, or environment variables
// on a host - env vars win when both are set. Addresses aren't
// secret, but SMTP credentials are, so on a public deployment
// prefer setting SMTP_* (and ACCESS_TOKEN) as env vars rather than
// committing them in config.json.
function loadConfig() {
  const fileConfig = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};

  const addresses = process.env.VAULT_ADDRESSES
    ? JSON.parse(process.env.VAULT_ADDRESSES)
    : fileConfig.addresses;

  if (!addresses || !addresses.length) {
    console.error(
      'No addresses configured. Set "addresses" in config.json, or the VAULT_ADDRESSES env var (a JSON array).'
    );
    process.exit(1);
  }

  return {
    addresses,
    email: {
      smtpHost: process.env.SMTP_HOST || fileConfig.email?.smtpHost,
      smtpPort: Number(process.env.SMTP_PORT || fileConfig.email?.smtpPort || 465),
      smtpUser: process.env.SMTP_USER || fileConfig.email?.smtpUser,
      smtpPassword: process.env.SMTP_PASSWORD || fileConfig.email?.smtpPassword,
      toAddress: process.env.SMTP_TO || fileConfig.email?.toAddress,
    },
    checkIntervalSeconds: Number(process.env.CHECK_INTERVAL_SECONDS || fileConfig.checkIntervalSeconds || 300),
    minimumNotifyAmount: Number(process.env.MIN_NOTIFY_AMOUNT || fileConfig.minimumNotifyAmount || 0),
    port: Number(process.env.PORT || fileConfig.port || 3000),
  };
}
const config = loadConfig();

// Set once you deploy somewhere public - every route below then
// requires it (as ?token=... or an X-Vault-Token header), so a
// stranger who finds the URL can't see your balances or register
// themselves for your push alerts. Unset (local use) = no check,
// same zero-friction behavior as before.
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || null;

function isAuthorized(req, url) {
  if (!ACCESS_TOKEN) return true;
  const headerToken = req.headers['x-vault-token'];
  const queryToken = url.searchParams.get('token');
  return headerToken === ACCESS_TOKEN || queryToken === ACCESS_TOKEN;
}

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465,
  auth: { user: config.email.smtpUser, pass: config.email.smtpPassword },
});

function loadState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return {};
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(STATE_PATH + '.tmp', STATE_PATH);
}

// Registered mobile devices (Expo push tokens), so checkAll() can
// alert your phone directly instead of (or alongside) email. Empty
// until the mobile app registers one - everything else keeps
// working exactly as before if you never use it.
function loadPushTokens() {
  if (fs.existsSync(PUSH_TOKENS_PATH)) return JSON.parse(fs.readFileSync(PUSH_TOKENS_PATH, 'utf8'));
  return [];
}
function addPushToken(token) {
  const tokens = loadPushTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    fs.writeFileSync(PUSH_TOKENS_PATH, JSON.stringify(tokens, null, 2));
  }
}
async function sendPushNotifications(title, body, data = {}) {
  const tokens = loadPushTokens();
  if (!tokens.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data }))),
    });
  } catch (err) {
    console.error('[error] push notification failed:', err.message);
  }
}

function looksLikeSecret(value) {
  const words = value.trim().split(/\s+/);
  if (words.length >= 11) return true; // BIP-39 phrases: 12/15/18/21/24 words
  const stripped = value.toLowerCase().startsWith('0x') ? value.slice(2) : value;
  if (stripped.length === 64 && /^[0-9a-fA-F]+$/.test(stripped)) return true; // raw private key
  return false;
}

const COINGECKO_IDS = {
  ETH: 'ethereum', SOL: 'solana', BTC: 'bitcoin', POL: 'matic-network', AVAX: 'avalanche-2',
  BNB: 'binancecoin', xDAI: 'xdai', FTM: 'fantom', MNT: 'mantle', CELO: 'celo', CRO: 'crypto-com-chain',
  GLMR: 'moonbeam', MOVR: 'moonriver', METIS: 'metis-token', MNT: 'mantle', SEI: 'sei-network',
  BERA: 'berachain-bera', S: 'sonic-3',
};

async function getUsdPrices(symbols) {
  const ids = [...new Set(symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean))];
  if (!ids.length) return {};
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`);
  const data = await res.json();
  const bySymbol = {};
  for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
    if (data[id]) bySymbol[sym] = data[id].usd;
  }
  return bySymbol;
}

let latestSnapshot = { entries: [], updatedAt: null };

async function checkAll() {
  const state = loadState();
  const entries = [];

  for (const entry of config.addresses) {
    const label = entry.label || entry.address;

    if (looksLikeSecret(entry.address)) {
      console.warn(`[refused] '${label}' looks like a seed phrase or private key, not an address - skipping.`);
      continue;
    }

    const adapter = ADAPTERS[entry.chain];
    if (!adapter) {
      console.warn(`[warn] unknown chain '${entry.chain}' for '${label}'`);
      continue;
    }

    let balance;
    try {
      balance = await adapter(entry.address, entry);
    } catch (err) {
      console.warn(`[warn] could not check '${label}': ${err.message}`);
      continue;
    }

    const key = `${balance.chain}:${entry.address}`;
    const previous = state[key]?.amount;
    const threshold = config.minimumNotifyAmount || 0;

    if (previous !== undefined && balance.amount > previous + threshold) {
      const increase = balance.amount - previous;
      const subject = `Funds received: ${label}`;

      try {
        await transporter.sendMail({
          from: config.email.smtpUser,
          to: config.email.toAddress,
          subject,
          text:
            `${increase.toFixed(6)} ${balance.symbol} arrived at ${label}.\n\n` +
            `New balance: ${balance.amount.toFixed(6)} ${balance.symbol}\n` +
            `Address: ${entry.address}\n` +
            `Chain: ${balance.chain}`,
        });
        console.log(`[notify] ${label}: +${increase.toFixed(6)} ${balance.symbol}`);
      } catch (err) {
        console.error(`[error] failed to send notification email for '${label}': ${err.message}`);
      }

      await sendPushNotifications(subject, `${increase.toFixed(6)} ${balance.symbol} arrived`, {
        chain: balance.chain,
        address: entry.address,
      });
    }

    state[key] = { amount: balance.amount, updatedAt: new Date().toISOString() };
    entries.push({
      label,
      chain: balance.chain,
      address: entry.address,
      amount: balance.amount,
      symbol: balance.symbol,
    });
  }

  saveState(state);

  const prices = await getUsdPrices(entries.map((e) => e.symbol)).catch(() => ({}));
  for (const e of entries) e.usdValue = e.amount * (prices[e.symbol] || 0);

  latestSnapshot = { entries, updatedAt: new Date().toISOString() };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Always open, even with ACCESS_TOKEN set - Render's health check
  // and any keep-alive pinger hit this, not the dashboard, so they
  // shouldn't need the token.
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (!isAuthorized(req, url)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  if (url.pathname === '/api/balances' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latestSnapshot));
    return;
  }

  if (url.pathname === '/api/register-push-token' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (!token || typeof token !== 'string') throw new Error('missing token');
        addPushToken(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Could not load dashboard');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const intervalMs = config.checkIntervalSeconds * 1000;

checkAll()
  .then(() => {
    server.listen(config.port, () => {
      console.log(`Dashboard on port ${config.port}  (checking every ${intervalMs / 1000}s)`);
      if (ACCESS_TOKEN) console.log('Access token required on all routes.');
    });
    setInterval(() => {
      checkAll().catch((err) => console.error('[error] check failed:', err.message));
    }, intervalMs);
  })
  .catch((err) => {
    console.error('Initial check failed:', err.message);
    process.exit(1);
  });
