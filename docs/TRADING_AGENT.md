# Trading agents

A user gives an AI agent a **mandate**, not their wallet: a dedicated wallet on Robinhood Chain, a capped allocation, strict risk rules and a list of assets. The model researches the market and proposes trades. Deterministic backend controls approve every trade before anything moves.

Agents trade **with real funds on Robinhood Chain mainnet (chain ID 4663)**. There is no simulated mode in the product. This document covers how it works, the switches that control it, the security checklist, and what has and has not been verified.

## Status

| Part | State |
| --- | --- |
| Mandate, strategy, permissions, versioning | Built |
| Deterministic risk engine (17 checks) | Built, with boundary and failure tests |
| Live execution: real swaps, simulated on the chain before signing | Built. Verified by simulation against mainnet state. **Not yet run with real funds** |
| Position monitor: stops, targets, trailing, time limits, circuit breakers | Built |
| Exact accounting from transaction receipts, wallet reconciliation | Built |
| Crash recovery for trades in flight | Built |
| Dedicated wallets, deposit, withdraw | Built. Withdrawals simulated on mainnet, not yet run with real funds |
| Security review of key custody and signing | **Not done** |

Paper Mode has been retired. Its fill model survives only as a fixture for tests and for agents created before the change, which no longer run on a server where live trading is on.

## The three switches

A trade is signed only if all three are on, and each is checked again at the last moment:

1. **`LIVE_TRADING=on`** on the server. Anything else, including unset, means no code path can sign a trade. Checked when a cycle starts, when a trade is reserved, and inside the signer.
2. **The agent is running** and its access has not been revoked. Re-read inside the transaction that reserves the trade.
3. **The wallet's trading authority** has not been revoked. Checked by the risk engine and again by the signer.

## How a trade happens

```text
Market scan            market-data.ts   prices for the allowlisted assets, from the first provider that answers
  ↓
Candidate filter       engine.ts        mandate market filters + strategy screens
  ↓                                     no candidate → the model is not called, no credits spent
Model                  proposal.ts      one call; reply parsed against a strict schema
  ↓
Structured proposal    trade_proposals  state PROPOSED
  ↓
Risk engine, stage 1   risk-engine.ts   checks 1–13, incl. the wallet's real USDG and gas → APPROVED
  ↓
Route + simulation     live-venue.ts    a route from LI.FI, validated, then run on the chain from
  ↓                                     the wallet (approve, then swap) with nothing signed → SIMULATED
Final pre-trade check  execution.ts     all 17 checks on fresh state, under the agent's lock;
  ↓                                     a "pending" fill reserves the capital → EXECUTING
Trade                  live-venue.ts    approve the exact amount; simulate once more; sign; save the
  ↓                                     hash; broadcast; wait for the receipt
Settle                 execution.ts     amounts read from the receipt's logs → OPEN (or FAILED)
  ↓
Position monitor       monitor.ts       every ~20 s, no model: stop, target, trailing, time limit;
  ↓                                     settles pending fills; reconciles wallet against positions
Exit                   execution.ts     the same reserve → trade → settle, selling back to USDG
  ↓
Audit log + notices    audit.ts, notify.ts
```

The model appears once and only produces text. Its reply is untrusted input: `parseProposals` checks each proposal alone against a strict schema, at most three are read, and each goes through the risk engine. It never sees a key, an address to send to, or calldata.

### Where a swap comes from, and why it is not trusted

Positions are bought with **USDG**, the chain's dollar stablecoin, and sold back to USDG. Routes come from [LI.FI](https://li.fi), which routes across the pools on Robinhood Chain (Uniswap v3 and v4 among them).

A route is calldata written by a third party, so `validateRoute` (`lifi.ts`) refuses it unless every one of these holds:

- it calls the **pinned router** `SWAP_ROUTER` (`chain.ts`), LI.FI's contract for chain 4663 as published in LI.FI's own chain registry, and asks for approval to that same address;
- it was built for this wallet, for exactly the requested tokens and input amount, on chain 4663;
- it attaches no ETH;
- its amounts and gas limit are sane.

It is then **simulated on the chain** from the real wallet with `eth_simulateV1`: approve the exact amount, then the swap. The tokens the simulation delivers to the wallet are read from its logs and are what the risk engine checks slippage and price impact against. Immediately before signing, the swap is simulated once more on the real allowance.

Approvals are for the exact amount of each trade, never unlimited.

### The signer

`tradeSigner` in `wallets.ts` is the only way the trading path can sign. It exposes two methods and neither takes a destination:

- `approveExact(token, amount)`: approves `amount` of `token` to the pinned router.
- `signRouterCall({ data, gas })`: signs a call to the pinned router with zero ETH.

So a wallet's key cannot be used by the trading code to send funds to any other address, whatever a route or a model says. Both switches (`LIVE_TRADING` and the wallet's authority) are read again before every signature, so one flipped in the middle of a trade stops the next signature. The key itself never leaves `wallets.ts`.

### Money cannot be lost track of

A live fill is three steps (`execution.ts`):

1. **Reserve.** Under the agent's database lock the final check runs and a `pending` fill is recorded. From this moment its capital counts as used, so a second trade cannot spend it.
2. **Trade.** The venue approves, simulates, signs, **saves the transaction hash**, then broadcasts and waits.
3. **Settle.** Amounts are read from the receipt and the position is recorded.

If the process dies or a confirmation is slow, the fill stays `pending`. `settlePending`, run by the monitor on every tick, resolves it from the chain:

- A fill with no hash was never signed, so it was never sent.
- A fill with a hash is looked up by it. A receipt settles it either way.
- No receipt after 15 minutes: the swap's nonce decides. If the wallet has since confirmed that nonce or a later one, the swap can never land and is written off. If not, a **buy** stays reserved and the agent is paused until it is settled; a **sale** is written off so the protective exit can be retried, and the retry takes the same place on the chain, so at most one of the two can land.

Nothing is ever re-sent on a guess. Idempotency keys (`entry:<proposal>`, `exit:<position>:<n>`) are unique in the database.

### PnL

Every figure on the dashboard comes from transactions, not quotes:

- **Entry**: dollars spent is the USDG that left the wallet in the swap's receipt; quantity is the tokens that arrived. Entry price is one divided by the other.
- **Exit**: proceeds are the USDG that arrived; realized PnL is proceeds minus the entry cost of the tokens sold.
- **Fees**: gas actually paid, from each receipt (approval and swap), at the ETH price at that moment. Gas paid by a trade that failed is counted too. Pool and router fees are inside the fill prices, so they appear in trading PnL rather than as a separate line.
- **Unrealized**: open quantity at the last market price, against its entry cost.

Each fill is listed on the dashboard with its transaction link. The monitor compares the wallet's on-chain token balances with what the open positions say is held, about once a minute; if the wallet holds less, it records `wallet.mismatch` and pauses the agent.

One approximation remains: USDG is counted as exactly $1.

### The seventeen checks

1. Trading enabled (mandate switch, agent running, access and wallet authority not revoked, permissions, mode, `LIVE_TRADING`, trading hours)
2. Allocation available, **and the wallet really holds the USDG and enough ETH for gas**
3. Position-size limit (the lower of the dollar cap and the percentage cap)
4. Total exposure limit
5. Open-position limit, one position per asset
6. Trade-frequency limit (per hour, per day, cooldown between trades)
7. Daily loss limit
8. Drawdown limit
9. Consecutive-loss breaker and cooldown after a loss
10. Asset on the allowlist, not on the blocklist, on Robinhood Chain
11. Liquidity, market cap, token age, fresh data
12. Valid stop loss, and planned loss within the per-trade limit
13. Minimum risk/reward
14. Slippage (how far below the simulated output the route may still fill) and price impact (simulated fill against the market price, pool fees included)
15. Transaction simulation on the chain
16. Network fee
17. Fresh quote

Any failure rejects. A value that is missing or not a finite number fails its check. A check that throws has failed. Reaching a loss limit exactly counts as reached.

**Accounting rule:** losses shrink what the agent can deploy; profits are not added to it. Available capital is `min(allocation, allocation + realized result) − open positions at cost − pending buys − reserve`.

### Protective exits

Stops, targets, trailing stops, break-even moves, partial exits and time limits are decided by `exits.ts` and executed by the monitor with no model involved.

A protective exit must get out, so a sale that fails is retried on the next tick with a wider slippage limit: it starts at the larger of the mandate's limit and 2%, and doubles for each failure in the last hour, up to 25%. A failed sale leaves the position open, is recorded with the gas it cost, and counts toward the "repeated failures" breaker.

### Circuit breakers

The monitor pauses new trading on: daily loss limit, drawdown limit, consecutive losses, exposure above the allocation, an open position with no price for five minutes, three market-data failures in a row, three failed simulations or sales in a row, a fill that slipped more than twice the mandate's limit, a wallet holding less than its positions record, or any state it cannot read. Pausing never stops protective exits. Resuming is manual.

### Emergency controls

| Control | Exactly what it does |
| --- | --- |
| Pause agent | No new positions from this moment. Stops, targets and time limits keep running on open positions. |
| Close all positions | Pauses the agent, then sells every open position back to USDG at the market. A position that cannot be priced or whose sale fails stays open under its stop, and the user is told. |
| Revoke trading access | Stops the agent and removes `PROPOSE_TRADE` and `EXECUTE_TRADE`. Open positions stay protected. Starting again takes a fresh review and approval. |
| Revoke trading authority (wallet) | No agent using that wallet can open a position, and the signer refuses to sign for it, until it is restored. |
| Withdraw funds | Only the signed-in user can move ETH or USDG out. Tokens held by open positions are sold with Close all positions first. |

### Where the plan's modules live

| Plan module | Code |
| --- | --- |
| automation-service | `src/app/trading-actions.ts`, `src/lib/trading/store.ts`, `queries.ts` |
| agent-runner | `engine.ts` (`runTradingCycle`) |
| market-data-service | `market-data.ts` |
| strategy-engine | `strategy.ts`, `proposal.ts` |
| risk-engine | `risk-engine.ts`, `mandate.ts`, `portfolio.ts` |
| quote-service, transaction-simulator | `lifi.ts`, `live-venue.ts` |
| execution-service | `execution.ts`, `live-venue.ts` |
| position-monitor | `monitor.ts`, `exits.ts` |
| wallet-service | `wallets.ts` |
| notification-service | `notify.ts` (reuses Connections) |
| audit-service | `audit.ts` |
| scheduler | `src/lib/scheduler.ts` → `tradingTick`; `startTradingMonitor`; `/api/cron/tick` |

Everything external (market data, the model, the clock, the venue) is passed in through `EngineDeps`, which is how the tests drive the whole path against a fake chain.

## Security checklist

| Rule from the plan | How it holds |
| --- | --- |
| 1. Keys never reach the model | The prompt is built from the mandate, portfolio numbers and market data. The key never leaves `wallets.ts`. |
| 2. Model cannot bypass the risk engine | The only path to a signature runs both risk stages. The model returns text and nothing else. |
| 3. Every live trade passes deterministic validation | `executeEntry` runs the final check itself, under the agent's lock. |
| 4. Simulate before signing | Twice: `eth_simulateV1` of approve-then-swap for the risk check, and an `eth_call` on the real allowance immediately before the signature. |
| 5. Hard capital allocation | Checks 2–4 under a per-agent lock; pending fills reserve capital; exact approvals cap what any one route can touch. |
| 6. Immediate kill switch | Pause, close all, revoke access, revoke wallet authority; re-read at reservation and in the signer. |
| 7. Breakers run outside the model | `monitor.ts` never calls a model. |
| 8. Monitoring survives model outages | The monitor depends on the database, market data and the chain only. |
| 9. Configuration versioned and auditable | Mandate, strategy and config versions; every trade stores the mandate version that approved it. |
| 10. Uncertain state stops trading | Fail-closed checks; unreadable balances refuse a trade; breakers on stale prices, failing providers and wallet mismatch. |
| 11. API auth and signing authority separate | Different encryption keys; the Accred API key cannot sign. |
| 12. Paper and Live share risk logic | One `evaluateRisk`. |
| 13. Never log signing secrets | `audit()` drops secret-named fields; route calldata is never stored; wallet errors show only their own messages. |
| 14. Never silently raise permissions or allocation | Profits are not redeployed; raises go through `riskIncreases`. |
| 15. Risk-increasing changes need approval | Server-side refusal without the named confirmation. |
| 16. Idempotent execution | Unique idempotency keys; state re-read under the lock; hash saved before broadcast; recovery from the chain. |

## What has and has not been verified

**Verified**

- The risk engine, accounting, state machine, exits and breakers: unit and database-backed tests.
- The live path end to end against a fake chain: reservation, settlement from receipts, failures, uncertain sends, crash recovery, reconciliation, the signer's limits.
- Against **mainnet state, read-only**: the real venue code fetched real routes and simulated a $20 USDG buy and the matching sell on the chain from addresses that hold the tokens. An empty wallet and an unknown token both fail simulation.

**Not verified. Do these before real users trade.**

1. **No real trade has been sent.** Signing and broadcasting are tested against a mocked chain only. Fund one wallet with about $20 of USDG and $2 of ETH and run one buy and one sell before opening this to anyone.
2. **Withdrawals have never been run with real funds.**
3. **No security review** of key custody or the signing design. The server holds the keys. `TRADING_WALLET_SECRET`, database access and backups decide who can reach them. The plan's preferred design, a smart account or session key with on-chain spending limits, is not built.
4. **LI.FI is a dependency in the money path.** If its API is down or rate-limits this server, nothing can be bought, and exits cannot be sold until it is back. Set `LIFI_API_KEY`. There is no second route source.
5. **LI.FI's router is upgradeable by LI.FI.** Exact approvals limit what a bad route or a compromised router could take to the size of one trade.
6. **Market data comes from public providers that limit requests by address.** DexScreener and GeckoTerminal are free and need no key, but a shared host such as Render sends everyone's requests from the same few addresses, so they often answer HTTP 429 through no doing of this app. Each read tries DexScreener (two endpoints), then GeckoTerminal, rests a provider that refuses for as long as it asks, and asks again over a few rounds about eight seconds long in all; the server logs every refusal. If none answers, a snapshot from the last 75 seconds is used again at its real age, which the 90-second freshness rule still judges. Beyond that nothing trades and stops are not checked until a provider answers. For agents that must not miss a price, set `COINGECKO_PRO_API_KEY` (or `COINGECKO_DEMO_API_KEY`, which is capped at a few thousand calls a month): that source is asked first and its limit is the key's own. A wrong price can trigger a stop or a target, and slippage and impact checks compare against it. GeckoTerminal and CoinGecko refresh less often than DexScreener, so stops can react later on them, and they count a pool's depth more narrowly, so liquidity reads lower and the minimum-liquidity check rejects more. Each scan records which provider it used.
7. **Tokens that cannot be sold.** A token that blocks transfers or taxes sells will fail its exit. The simulation catches a buy that delivers nothing, not a token that turns hostile later. Users choose the allowlist.
8. **USDG is treated as $1.**
9. **The public RPC is rate-limited.** Set `ROBINHOOD_RPC_URL` to a dedicated provider that supports `eth_simulateV1`; without that method nothing passes check 15.
10. **Legal and compliance review** of automated trading and of holding user keys, including tokenized stocks on this chain.

## Running it

| Variable | Purpose |
| --- | --- |
| `LIVE_TRADING` | Set to `on` to let agents trade. Anything else: no trade can be signed and no agent can be started. |
| `TRADING_WALLET_SECRET` | 32+ characters. Encrypts wallet keys. Set it before the first wallet is created and never change it. Without it, a key derived from `APP_SECRET` is used. |
| `ROBINHOOD_RPC_URL` | An HTTPS RPC endpoint tried before the public ones. Must support `eth_simulateV1`. |
| `LIFI_API_KEY` | Raises LI.FI's request limit. |
| `COINGECKO_PRO_API_KEY` or `COINGECKO_DEMO_API_KEY` | Market data whose request limit belongs to the key. Without one, prices come only from free providers that often refuse a shared host. |

Run one instance. Trades for one wallet are serialised inside the process.

Tests:

```bash
pnpm test                       # unit tests; database tests are skipped
createdb accred_automation_trading
DATABASE_URL=postgres://localhost:5432/accred_automation_trading pnpm db:migrate
TRADING_TEST_DATABASE_URL=postgres://localhost:5432/accred_automation_trading pnpm test
```

No test signs or sends a real transaction.
