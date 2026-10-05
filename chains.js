'use strict';

// Watch-only chain adapters. These adapters NEVER accept private keys or seed phrases.
// EVM networks share the same eth_getBalance interface, so one adapter can cover many chains.

const RPC = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  optimism: 'https://optimism-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',
  gnosis: 'https://gnosis-rpc.publicnode.com',
  fantom: 'https://fantom-rpc.publicnode.com',
  linea: 'https://linea-rpc.publicnode.com',
  scroll: 'https://scroll-rpc.publicnode.com',
  zksync: 'https://1rpc.io/zksync2-era',
  mantle: 'https://rpc.mantle.xyz',
  celo: 'https://forno.celo.org',
  cronos: 'https://evm.cronos.org',
  opbnb: 'https://opbnb-mainnet-rpc.bnbchain.org',
  moonbeam: 'https://rpc.api.moonbeam.network',
  moonriver: 'https://rpc.api.moonriver.moonbeam.network',
  metis: 'https://andromeda.metis.io/?owner=1088',
  blast: 'https://rpc.blast.io',
  mode: 'https://mainnet.mode.network',
  taiko: 'https://rpc.mainnet.taiko.xyz',
  sei_evm: 'https://evm-rpc.sei-apis.com',
  berachain: 'https://rpc.berachain.com',
  ink: 'https://rpc-gel.inkonchain.com',
  sonic: 'https://rpc.soniclabs.com',
};

const EVM_CHAINS = {
  ethereum: { symbol: 'ETH', chainName: 'ethereum', rpcUrl: RPC.ethereum },
  base: { symbol: 'ETH', chainName: 'base', rpcUrl: RPC.base },
  arbitrum: { symbol: 'ETH', chainName: 'arbitrum', rpcUrl: RPC.arbitrum },
  optimism: { symbol: 'ETH', chainName: 'optimism', rpcUrl: RPC.optimism },
  polygon: { symbol: 'POL', chainName: 'polygon', rpcUrl: RPC.polygon },
  avalanche: { symbol: 'AVAX', chainName: 'avalanche', rpcUrl: RPC.avalanche },
  bsc: { symbol: 'BNB', chainName: 'bsc', rpcUrl: RPC.bsc },
  gnosis: { symbol: 'xDAI', chainName: 'gnosis', rpcUrl: RPC.gnosis },
  fantom: { symbol: 'FTM', chainName: 'fantom', rpcUrl: RPC.fantom },
  linea: { symbol: 'ETH', chainName: 'linea', rpcUrl: RPC.linea },
  scroll: { symbol: 'ETH', chainName: 'scroll', rpcUrl: RPC.scroll },
  zksync: { symbol: 'ETH', chainName: 'zksync', rpcUrl: RPC.zksync },
  mantle: { symbol: 'MNT', chainName: 'mantle', rpcUrl: RPC.mantle },
  celo: { symbol: 'CELO', chainName: 'celo', rpcUrl: RPC.celo },
  cronos: { symbol: 'CRO', chainName: 'cronos', rpcUrl: RPC.cronos },
  opbnb: { symbol: 'BNB', chainName: 'opbnb', rpcUrl: RPC.opbnb },
  moonbeam: { symbol: 'GLMR', chainName: 'moonbeam', rpcUrl: RPC.moonbeam },
  moonriver: { symbol: 'MOVR', chainName: 'moonriver', rpcUrl: RPC.moonriver },
  metis: { symbol: 'METIS', chainName: 'metis', rpcUrl: RPC.metis },
  blast: { symbol: 'ETH', chainName: 'blast', rpcUrl: RPC.blast },
  mode: { symbol: 'ETH', chainName: 'mode', rpcUrl: RPC.mode },
  taiko: { symbol: 'ETH', chainName: 'taiko', rpcUrl: RPC.taiko },
  sei_evm: { symbol: 'SEI', chainName: 'sei_evm', rpcUrl: RPC.sei_evm },
  berachain: { symbol: 'BERA', chainName: 'berachain', rpcUrl: RPC.berachain },
  ink: { symbol: 'ETH', chainName: 'ink', rpcUrl: RPC.ink },
  sonic: { symbol: 'S', chainName: 'sonic', rpcUrl: RPC.sonic },
};

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

async function evmBalance(address, { rpcUrl, symbol, chainName, decimals = 18 } = {}) {
  const hex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  if (typeof hex !== 'string' || !/^0x[0-9a-f]+$/i.test(hex)) throw new Error('Invalid EVM balance response');
  return { chain: chainName, symbol, amount: Number(BigInt(hex)) / 10 ** decimals };
}

async function solBalance(address, { rpcUrl = SOL_RPC } = {}) {
  const result = await rpcCall(rpcUrl, 'getBalance', [address]);
  return { chain: 'solana', symbol: 'SOL', amount: result.value / 1e9 };
}

async function btcBalance(address, { apiBase = BTC_API } = {}) {
  const res = await fetch(`${apiBase}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Blockstream error ${res.status}`);
  const data = await res.json();
  const sats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  return { chain: 'bitcoin', symbol: 'BTC', amount: sats / 1e8 };
}

const ADAPTERS = {
  solana: solBalance,
  bitcoin: btcBalance,
};

for (const [name, settings] of Object.entries(EVM_CHAINS)) {
  ADAPTERS[name] = (address, entry = {}) => evmBalance(address, {
    ...settings,
    ...entry,
    rpcUrl: entry.rpcUrl || settings.rpcUrl,
    symbol: entry.symbol || settings.symbol,
    chainName: entry.chainName || settings.chainName,
  });
}

module.exports = { ADAPTERS, EVM_CHAINS };
