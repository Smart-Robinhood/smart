// Simulates SmartBuyback against live Robinhood Chain state (eth_call with state overrides, nothing is sent).
// Run: node sim.mjs
import { readFileSync } from 'node:fs';
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, parseEther, formatEther, padHex } from 'viem';
import { buildSwap } from '../scripts/swap-lib.mjs';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const { abi, bytecode } = JSON.parse(readFileSync(new URL('./build/SmartBuyback.json', import.meta.url), 'utf8'));
const SMART = '0x0b78f8903265d93c0c156fba5c589b2d3eb2689b';
const SMART_CURVE = '0x32968c128ed2ea3d19ceb595f6133e51d7aaae72';
const GRADUATED = '0x5a8e6bb390b51978b0cea029a070cfcdd495138e'; // a Pons token already in its v4 pool
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const DEAD = '0x000000000000000000000000000000000000dead';
const X = '0x5111111111111111111111111111111111111115'; // where the simulated contract lives
const USER = '0x7777777777777777777777777777777777777777';

async function rpc(method, params) {
  const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(j.error.message + (j.error.data ? ' ' + j.error.data : ''));
  return j.result;
}
const hex = (v) => '0x' + BigInt(v).toString(16);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`); };

// runtime code = what the constructor returns
async function runtime(token, curve) {
  const data = encodeDeployData({ abi, bytecode, args: [token, curve, 0, 200, parseEther('0.001'), parseEther('0.5')] });
  return rpc('eth_call', [{ data }, 'latest']);
}
const balanceOf = async (token, who, overrides) => BigInt(await rpc('eth_call', [{ to: token, data: '0x70a08231' + who.slice(2).padStart(64, '0') }, 'latest', overrides]));

async function curveOf(token) {
  const head = Number(await rpc('eth_blockNumber', []));
  const logs = await rpc('eth_getLogs', [{ address: FACTORY, topics: [LAUNCH, padHex(token, { size: 32 })], fromBlock: hex(Math.max(0, head - 9_900_000)), toBlock: 'latest' }]);
  return '0x' + logs[0].topics[2].slice(26);
}

async function buyback(token, curve, eth) {
  const code = await runtime(token, curve);
  const overrides = { [X]: { code, balance: hex(parseEther(eth)) } };
  const out = await rpc('eth_call', [{ from: USER, to: X, data: encodeFunctionData({ abi, functionName: 'buyback' }), gas: hex(3_000_000) }, 'latest', overrides]);
  return { burned: decodeFunctionResult({ abi, functionName: 'buyback', data: out }), code };
}

// 1. $SMART is on its curve: buy there, tokens land on the burn address
{
  const { burned } = await buyback(SMART, SMART_CURVE, '0.01');
  check('$SMART buyback on the Pons curve', burned > 0n, `0.01 ETH -> ${Number(formatEther(burned)).toLocaleString('en-US')} $SMART burned`);
}

// 2. a graduated Pons token: the curve refuses, the contract buys in the v4 pool instead
{
  const curve = await curveOf(GRADUATED);
  const { burned } = await buyback(GRADUATED, curve, '0.01');
  check('graduated token buyback through the Uniswap v4 pool', burned > 0n, `0.01 ETH -> ${Number(formatEther(burned)).toLocaleString('en-US')} burned`);
}

// 3. too little ETH: buyback refuses
try {
  await buyback(SMART, SMART_CURVE, '0.0005');
  check('refuses below minBuy', false);
} catch (e) { check('refuses below minBuy', /not enough ETH/.test(e.message) || /revert/.test(e.message), e.message.slice(0, 60)); }

// 4. maxBuy caps one buyback
{
  const { burned: small } = await buyback(SMART, SMART_CURVE, '0.5');
  const { burned: big } = await buyback(SMART, SMART_CURVE, '2');
  check('maxBuy caps a single buyback at 0.5 ETH', small === big, `${formatEther(small)} vs ${formatEther(big)}`);
}

// 5. a real Smart swap paying its fee into the contract: the fee that tips it over triggers the burn,
//    and the user's swap still goes through
{
  const code = await runtime(SMART, SMART_CURVE);
  const key = { c0: '0x0000000000000000000000000000000000000000', c1: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', fee: 0x800000, ts: 10, hooks: '0x06a889870c8f83640d6816319f72e2aa579b6080' };
  const tx = buildSwap({ key, side: 'buy', amountIn: parseEther('0.4'), minOut: 0n, user: USER, feeBips: 25, feeRecipient: X, deadline: Math.floor(Date.now() / 1000) + 600 });
  const overrides = { [X]: { code, balance: hex(parseEther('0.0009')) }, [USER]: { balance: hex(parseEther('1')) } };
  const deadBefore = await balanceOf(SMART, DEAD, overrides);
  try {
    await rpc('eth_call', [{ from: USER, to: tx.to, data: tx.data, value: hex(tx.value), gas: hex(3_000_000) }, 'latest', overrides]);
    check('Smart swap with the fee paid into the contract goes through', true, '(0.4 ETH swap, 0.001 ETH fee tips the contract over minBuy)');
  } catch (e) { check('Smart swap with the fee paid into the contract goes through', false, e.message.slice(0, 120)); }
  void deadBefore;
}

// 6. a plain ETH transfer below minBuy just waits
{
  const code = await runtime(SMART, SMART_CURVE);
  const overrides = { [X]: { code, balance: '0x0' }, [USER]: { balance: hex(parseEther('1')) } };
  try { await rpc('eth_call', [{ from: USER, to: X, value: hex(parseEther('0.0001')), gas: hex(300_000) }, 'latest', overrides]); check('small fee is accepted and waits', true); }
  catch (e) { check('small fee is accepted and waits', false, e.message); }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
