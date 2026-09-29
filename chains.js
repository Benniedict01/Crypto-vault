'use strict';

// Each adapter takes a PUBLIC address and returns its balance.
// None of them accept or need a private key or seed phrase - that's
// the point: watching a balance only ever requires the address.

const ETH_RPC = 'https://ethereum-rpc.publicnode.com';
const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const BTC_API = 'https://blockstream.info/api';

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

// Works for any EVM chain, not just Ethereum - pass a different
// rpcUrl/symbol/chainName (Polygon, Base, Arbitrum, ...) and this
// same function handles it. See README "Adding chains".
async function ethBalance(address, { rpcUrl = ETH_RPC, symbol = 'ETH', chainName = 'ethereum' } = {}) {
  const hex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  return { chain: chainName, symbol, amount: parseInt(hex, 16) / 1e18 };
}

async function solBalance(address, { rpcUrl = SOL_RPC } = {}) {
  const result = await rpcCall(rpcUrl, 'getBalance', [address]);
  return { chain: 'solana', symbol: 'SOL', amount: result.value / 1e9 };
}

// UTXO-based, so this one talks REST (Blockstream's Esplora API)
// instead of JSON-RPC - a useful second pattern to copy from when
// adding a chain that isn't account-based.
async function btcBalance(address, { apiBase = BTC_API } = {}) {
  const res = await fetch(`${apiBase}/address/${address}`);
  if (!res.ok) throw new Error(`Blockstream error ${res.status}`);
  const data = await res.json();
  const sats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  return { chain: 'bitcoin', symbol: 'BTC', amount: sats / 1e8 };
}

const ADAPTERS = { ethereum: ethBalance, solana: solBalance, bitcoin: btcBalance };

module.exports = { ADAPTERS };
