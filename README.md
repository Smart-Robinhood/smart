# Smart

**Trade any Uniswap v4 hook pool on Robinhood Chain.**

There are 29,000+ Uniswap v4 hooks on Robinhood Chain and almost none of them have a place to trade. Smart is the front door: paste any hook pool, token or hook, see exactly what the hook is allowed to do, and swap in one click through the official Uniswap Universal Router, from your own wallet.

- Live hook pools ranked by swaps right now
- Hook permissions decoded from the hook address, with risk labels
- Buy and sell through the Universal Router, simulated before every signature
- Shareable pool links: `smartrobin.xyz/?pool=0x…`
- 0.25% swap fee in ETH that buys back and burns $SMART

Site: [smartrobin.xyz](https://smartrobin.xyz) · Token: `$SMART` `0x0b78f8903265d93c0c156fba5c589b2d3eb2689b`

## How a swap works

Smart builds standard Universal Router calldata in the browser (`scripts/swap-lib.mjs`):

- **Buy (ETH → token):** `TRANSFER` (0.25% fee in ETH) + `V4_SWAP` with actions `SWAP_EXACT_IN_SINGLE · SETTLE_ALL · TAKE_ALL`
- **Sell (token → ETH):** `V4_SWAP` with `SWAP_EXACT_IN_SINGLE · SETTLE_ALL · TAKE` (into the router), then `PAY_PORTION` (fee) and `SWEEP` (rest to the user, enforcing the minimum)

Sells use Permit2 approvals, like every Uniswap interface. Funds never pass through a Smart contract.

## Buyback contract

`contracts/SmartBuyback.sol` receives the swap fees. Its ETH can only buy $SMART and send it to `0x…dEaD`:

- **No owner, no withdraw**, nothing to configure
- Buys on the Pons bonding curve while $SMART is on it; after graduation it buys in the Uniswap v4 pool (ETH / $SMART, Pons graduation hook)
- Triggers itself inside a swap once 0.001 ETH is waiting; anyone can call `buyback()`; at most 0.5 ETH per buyback

Simulated against live chain state (`node contracts/sim.mjs`): curve buyback, v4 buyback for a graduated Pons token, limits, a real Smart swap paying its fee into the contract, and small fees waiting.

```bash
cd contracts
npm install
node compile.mjs   # solc 0.8.24, optimizer 200, evm cancun
node sim.mjs       # eth_call with state overrides, nothing is sent
```

Deploy with any tool (Remix works). Constructor arguments:

```
token_       0x0b78f8903265d93c0c156fba5c589b2d3eb2689b
curve_       0x32968c128ed2ea3d19ceb595f6133e51d7aaae72
poolFee_     0
tickSpacing_ 200
minBuy_      1000000000000000      (0.001 ETH)
maxBuy_      500000000000000000    (0.5 ETH)
```

## Repository

```
site/index.html        the app (single file; settings in the CONFIG block)
scripts/fetch-hooks.mjs  snapshot of every v4 pool and hook on Robinhood Chain
scripts/build-single.mjs embeds the snapshot into one deployable HTML file
scripts/swap-lib.mjs     Universal Router encoder (buy/sell with fee)
scripts/sim*.mjs         swap simulations against live chain state
data/hooks.json          latest hooks snapshot
contracts/               SmartBuyback + compile + simulation
```

Build the deployable page:

```bash
node --max-old-space-size=4096 scripts/fetch-hooks.mjs   # refresh the snapshot (optional)
node scripts/build-single.mjs dist                        # writes dist/index.html
```

`site/index.html` can use an optional private RPC (`fastRpc` in CONFIG) for reads; it falls back to the public Robinhood Chain RPC.

## Addresses (Robinhood Chain, 4663)

| | |
|---|---|
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| $SMART | `0x0b78f8903265d93c0c156fba5c589b2d3eb2689b` |

## Disclaimer

Smart is an independent interface for Uniswap v4 pools. Not affiliated with Uniswap Labs, Robinhood, Pons or any project shown. Hooks are code written by strangers: check the permissions. Nothing here is financial advice.

## License

MIT
