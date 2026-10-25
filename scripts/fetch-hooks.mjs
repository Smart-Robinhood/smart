// Builds data/hooks.json: every Uniswap v4 hook on Robinhood Chain with its pool count and recent swaps.
// The full pool history is too large for a browser, so the site ships this snapshot and adds live swaps on top.
// Run: node scripts/fetch-hooks.mjs   (takes a few minutes; the public RPC rate-limits bursts)
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const INITIALIZE = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const SWAP_HOURS = Number(process.env.SWAP_HOURS || 6);
const SEC_PER_BLOCK = 0.103;
const NO_HOOK = '0000000000000000000000000000000000000000';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hex = (n) => '0x' + n.toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let a = 0; ; a++) {
    let j;
    try { j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); }
    catch { j = { error: { message: 'too many (fetch failed)' } }; }
    if (!j.error && j.result !== undefined) return j.result;
    const msg = j.error?.message || 'empty reply';
    if (/exceeds limit|allowed for this request/i.test(msg)) throw Object.assign(new Error(msg), { split: true });
    if (a < 40) { await sleep(Math.min(12000, 1500 * (a + 1))); continue; }
    throw new Error(msg);
  }
}

// fetch logs over [from, to], halving the range whenever the RPC says there are too many
async function logs(filter, from, to, onBatch) {
  const stack = [[from, to]];
  let n = 0;
  while (stack.length) {
    const [a, b] = stack.pop();
    try {
      const got = await rpc('eth_getLogs', [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }]);
      onBatch(got);
      if (++n % 40 === 0) console.error(`  ${n} queries, at block ${b}`);
      await sleep(150);
    } catch (e) {
      if (!e.split || b <= a) throw e;
      const m = Math.floor((a + b) / 2);
      stack.push([m + 1, b], [a, m]);
    }
  }
}

const head = parseInt(await rpc('eth_blockNumber', []), 16);
console.error('head', head);

// 1) every pool ever initialized, grouped by hook
const hooks = new Map(); // hook -> { pools, first, last }
const poolHook = new Map(); // pool id -> hook
const poolKey = new Map(); // pool id -> [currency0, currency1, fee, tickSpacing] (kept only for pools that swapped)
let pools = 0;
console.error('scanning pool initializations…');
for (let f = 0; f <= head; f += 5_000_000) {
  await logs({ address: POOL_MANAGER, topics: [INITIALIZE] }, f, Math.min(head, f + 4_999_999), (batch) => {
    for (const l of batch) {
      const hook = l.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3);
      const b = parseInt(l.blockNumber, 16);
      pools++;
      poolHook.set(l.topics[1], hook);
      const w = l.data.slice(2).match(/.{64}/g);
      poolKey.set(l.topics[1], ['0x' + l.topics[2].slice(26), '0x' + l.topics[3].slice(26), parseInt(w[0], 16), (parseInt(w[1], 16) << 8) >> 8]);
      let h = hooks.get(hook);
      if (!h) hooks.set(hook, (h = { pools: 0, first: b, last: b }));
      h.pools++;
      h.first = Math.min(h.first, b);
      h.last = Math.max(h.last, b);
    }
  });
}
console.error('pools', pools, 'hooks', hooks.size);

// 2) swaps over the last SWAP_HOURS hours, per hook and per pool
const swapFrom = head - Math.round((SWAP_HOURS * 3600) / SEC_PER_BLOCK);
const poolSwaps = new Map();
let swaps = 0;
console.error(`scanning swaps, last ${SWAP_HOURS}h…`);
await logs({ address: POOL_MANAGER, topics: [SWAP] }, swapFrom, head, (batch) => {
  for (const l of batch) {
    swaps++;
    poolSwaps.set(l.topics[1], (poolSwaps.get(l.topics[1]) || 0) + 1);
  }
});
const hookSwaps = new Map();
for (const [id, n] of poolSwaps) {
  const h = poolHook.get(id);
  if (h) hookSwaps.set(h, (hookSwaps.get(h) || 0) + n);
}
console.error('swaps', swaps, 'active pools', poolSwaps.size);

// compact output: hooks as [address, pools, firstBlock, lastInitBlock, swaps], active pools as id -> hook index
// one-pool hooks with no swaps are counted in the totals but left out of the list, to keep the page light
const allHooks = [...hooks].filter(([h]) => h !== NO_HOOK);
const list = allHooks.filter(([h, v]) => v.pools >= 2 || hookSwaps.get(h)).sort((a, b) => (hookSwaps.get(b[0]) || 0) - (hookSwaps.get(a[0]) || 0) || b[1].pools - a[1].pools);
const index = new Map(list.map(([h], i) => [h, i]));
const activePools = {};
for (const [id] of poolSwaps) {
  const h = poolHook.get(id);
  activePools[id.slice(2, 18)] = h === NO_HOOK ? -1 : (index.has(h) ? index.get(h) : -2); // first 8 bytes of the id are plenty to tell pools apart
}
// the busiest pools with their full keys, so the site can build swaps without looking them up
const topPools = [...poolSwaps].sort((a, b) => b[1] - a[1]).slice(0, 300).filter(([id]) => poolKey.has(id)).map(([id, n]) => {
  const [c0, c1, fee, ts] = poolKey.get(id);
  return [id, c0, c1, fee, ts, '0x' + poolHook.get(id), n];
});
const out = {
  updated: new Date().toISOString(),
  head,
  swapHours: SWAP_HOURS,
  totals: { pools, hookedPools: pools - (hooks.get(NO_HOOK)?.pools || 0), hooks: allHooks.length, listed: list.length, swaps, hookedSwaps: [...hookSwaps].filter(([h]) => h !== NO_HOOK).reduce((s, [, n]) => s + n, 0) },
  hooks: list.map(([h, v]) => [h, v.pools, v.first, v.last, hookSwaps.get(h) || 0]),
  activePools,
  topPools,
};
await mkdir(path.join(root, 'data'), { recursive: true });
await writeFile(path.join(root, 'data', 'hooks.json'), JSON.stringify(out));
console.error(`wrote data/hooks.json: ${list.length} hooks, ${Object.keys(activePools).length} active pools`);
