// Builds Universal Router calldata for a single-pool Uniswap v4 swap, with a front-end fee in ETH.
// The same code is pasted into the site; this module exists so it can be simulated from Node.
export const UNIVERSAL_ROUTER = '0x8876789976decbfcbbbe364623c63652db8c0904';
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const ETH = '0x0000000000000000000000000000000000000000';
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'; // v4-periphery: keep funds in the router

const w = (v) => (typeof v === 'bigint' ? (v < 0n ? (1n << 256n) + v : v) : BigInt(v)).toString(16).padStart(64, '0');
const addr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const hexLen = (h) => w(h.length / 2);
const pad32 = (h) => h.padEnd(Math.ceil(h.length / 64) * 64, '0');
const bytes = (h) => hexLen(h) + pad32(h); // length-prefixed bytes body
// abi.encode of a bytes[]: offsets then bodies
function bytesArray(items) {
  let off = items.length * 32;
  const heads = [], bodies = [];
  for (const it of items) { heads.push(w(off)); const b = bytes(it); bodies.push(b); off += b.length / 2; }
  return w(items.length) + heads.join('') + bodies.join('');
}

// ExactInputSingleParams { PoolKey key; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; bytes hookData }
function exactInSingle(key, zeroForOne, amountIn, minOut) {
  const head = addr(key.c0) + addr(key.c1) + w(key.fee) + w(BigInt(key.ts)) + addr(key.hooks)
    + w(zeroForOne ? 1 : 0) + w(amountIn) + w(minOut) + w(32 * 9); // hookData offset, relative to the tuple start
  return w(32) + head + w(0); // outer offset, tuple, empty hookData
}

// abi.encode(bytes actions, bytes[] params)
const v4Input = (actions, params) => { const a = bytes(actions); return w(64) + w(64 + a.length / 2) + a + bytesArray(params); };

/**
 * buy: ETH -> token. Fee is cut from the ETH first (TRANSFER), the rest is swapped; the user receives the tokens.
 * sell: token -> ETH. Output ETH is taken into the router, the fee is paid (PAY_PORTION) and the rest swept to the user.
 */
export function buildSwap({ key, side, amountIn, minOut, user, feeBips, feeRecipient, deadline }) {
  const ethIs0 = key.c0.toLowerCase() === ETH;
  if (!ethIs0) throw new Error('only ETH-paired pools');
  const commands = [], inputs = [];
  if (side === 'buy') {
    const fee = (amountIn * BigInt(feeBips)) / 10000n;
    const swapIn = amountIn - fee;
    if (fee > 0n) { commands.push('05'); inputs.push(addr(ETH) + addr(feeRecipient) + w(fee)); } // TRANSFER fee in ETH
    commands.push('10');
    inputs.push(v4Input('060c0f', [
      exactInSingle(key, true, swapIn, minOut),
      addr(key.c0) + w(swapIn), // SETTLE_ALL(currency, maxAmount)
      addr(key.c1) + w(minOut), // TAKE_ALL(currency, minAmount) to the user
    ]));
    return { to: UNIVERSAL_ROUTER, value: amountIn, data: '0x3593564c' + execute(commands, inputs, deadline) };
  }
  commands.push('10');
  inputs.push(v4Input('060c0e', [
    exactInSingle(key, false, amountIn, 0n),
    addr(key.c1) + w(amountIn), // SETTLE_ALL token from the user via Permit2
    addr(key.c0) + addr(ADDRESS_THIS) + w(0), // TAKE all ETH into the router
  ]));
  if (feeBips > 0) { commands.push('06'); inputs.push(addr(ETH) + addr(feeRecipient) + w(feeBips)); } // PAY_PORTION
  commands.push('04'); inputs.push(addr(ETH) + addr(user) + w(minOut)); // SWEEP the rest to the user, enforcing the minimum
  return { to: UNIVERSAL_ROUTER, value: 0n, data: '0x3593564c' + execute(commands, inputs, deadline) };
}

// execute(bytes commands, bytes[] inputs, uint256 deadline)
function execute(commands, inputs, deadline) {
  const c = bytes(commands.join(''));
  return w(96) + w(96 + c.length / 2) + w(deadline) + c + bytesArray(inputs);
}
