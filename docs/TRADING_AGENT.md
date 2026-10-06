# Trading agents

A user gives an AI agent a **mandate**, not their wallet: a dedicated wallet on Robinhood Chain, a capped allocation, strict risk rules and a list of assets. The model researches the market and proposes trades. Deterministic backend controls approve every trade before anything moves.

This document covers what is built, how it maps to the plan, the security checklist, and what blocks Live Mode.

## Status

| Phase | State |
| --- | --- |
| 1. Safe foundation: dedicated wallet, deposit and withdraw, allocation, Paper Mode, market data, structured proposals, risk engine, audit log, dashboard, manual start and stop | Built |
| 2. Controlled live trading | **Not built. Live Mode is locked in code.** Its model-free parts are built and run in Paper Mode: position monitor, stop loss and take profit, loss and drawdown limits, emergency controls, notifications, asset allowlist |
| 3. Advanced automation | Built for Paper Mode: trailing stops, partial exits, break-even, time limits, interval schedules, trading hours, market filters, natural-language strategy, several agents per user, paper analytics |
| 4. Permissioned infrastructure: session keys, smart accounts, onchain spending limits | Not started. See [Blockers](#what-blocks-live-mode) |

**Live Mode cannot be switched on by configuration.** `src/lib/trading/live.ts` exports `LIVE_TRADING_AVAILABLE = false`, and there is no swap-building or trade-signing code in the app for a setting to enable. The server refuses to save a mandate whose mode is `live`, the engine skips any agent that is not in Paper Mode, and risk check 1 fails for a live agent.

## How a trade happens

```text
Market scan            market-data.ts   DexScreener prices for the allowlisted assets
  ↓
Candidate filter       engine.ts        mandate market filters + strategy screens (strategy.ts)
  ↓                                     no candidate → the model is not called, no credits spent
Model                  proposal.ts      one call; reply parsed against a strict schema
  ↓
Structured proposal    trade_proposals  state PROPOSED
  ↓
Risk engine, stage 1   risk-engine.ts   checks 1–13 → APPROVED or RISK_REJECTED
  ↓
Quote + simulation     quote.ts         fresh price, modelled fill, network fee → SIMULATED
  ↓
Final pre-trade check  execution.ts     all 17 checks on fresh state, under the agent's lock
  ↓
Execution              execution.ts     paper fill + position, same transaction → OPEN
  ↓
Position monitor       monitor.ts       every ~20 s, no model: stop, target, trailing, time limit
  ↓
Exit                   execution.ts     PARTIAL_EXIT / CLOSED
  ↓
Audit log + notices    audit.ts, notify.ts
```

The model appears once in that chain and only produces text. Its reply is untrusted input: `parseProposals` checks each proposal alone against a strict schema (unknown keys, string numbers, other actions and missing fields are dropped), at most three are read, and each then goes through the risk engine. The asset it names is resolved against the allowlist by address or exact symbol; anything else is recorded and rejected.

### Where the plan's modules live

| Plan module | Code |
| --- | --- |
| automation-service | `src/app/trading-actions.ts`, `src/lib/trading/store.ts`, `queries.ts` |
| agent-runner | `src/lib/trading/engine.ts` (`runTradingCycle`) |
| market-data-service | `src/lib/trading/market-data.ts` |
| strategy-engine | `src/lib/trading/strategy.ts`, `proposal.ts` |
| risk-engine | `src/lib/trading/risk-engine.ts`, `mandate.ts`, `portfolio.ts` |
| quote-service, transaction-simulator | `src/lib/trading/quote.ts` (paper model), `chain.ts` (gas and ETH price) |
| execution-service | `src/lib/trading/execution.ts` |
| position-monitor | `src/lib/trading/monitor.ts`, `exits.ts` |
| wallet-service | `src/lib/trading/wallets.ts` |
| notification-service | `src/lib/trading/notify.ts` (reuses Connections) |
| audit-service | `src/lib/trading/audit.ts` |
| scheduler | `src/lib/scheduler.ts` → `tradingTick`; `startTradingMonitor` in `instrumentation.ts`; `/api/cron/tick` |

`risk-engine.ts`, `portfolio.ts`, `exits.ts`, `mandate.ts`, `states.ts` and `quote.ts` are pure: no database, no network, no model. The engine and monitor take everything external (market data, gas, the model, the clock) through `EngineDeps`, which is how the tests drive them.

### Data models

`trading_automations`, `trading_wallets`, `risk_mandates`, `trading_strategies`, `trade_proposals`, `risk_evaluations`, `executions`, `positions`, `trading_runs` (the plan's AgentRun) and `audit_events`. Migration: `drizzle/0002_trading_agents.sql`.

- **Versioning.** A mandate or strategy is never edited in place. An edit inserts version n+1 and bumps the agent's `configVersion`. Every proposal, risk evaluation, execution and position stores the `mandate_id` and version that governed it. An entry whose mandate changed between proposal and execution is rejected. An open position keeps the exit rules of the version that approved it.
- **Risk-increasing changes.** `riskIncreases(before, after)` lists every loosening (higher caps, lower filters, protections turned off, assets added, hours widened, permissions added). A save with any of them is refused until the user ticks a confirmation that names each one; the confirmed list is stored with the new version.
- **Risk evaluations** store all seventeen checks with their verdicts and the full inputs, so a decision can be replayed.

### The seventeen checks

1. Trading enabled (mandate switch, agent running, access and wallet authority not revoked, permissions, mode, trading hours)
2. Allocation available
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
14. Slippage and price impact
15. Transaction simulation
16. Network fee
17. Fresh quote

Any failure rejects. A value that is missing or not a finite number fails its check. A check that throws has failed. Reaching a loss limit exactly counts as reached.

**Accounting rule:** losses shrink what the agent can deploy; profits are not added to it. Available capital is `min(allocation, allocation + realized result) − open positions at cost − reserve`. The allocation only ever changes when the user edits the mandate.

### Trade states

`DISCOVERED → PROPOSED → APPROVED → SIMULATED → EXECUTING → OPEN → PARTIAL_EXIT → CLOSED`, with `RISK_REJECTED`, `FAILED` and `CANCELLED` as dead ends. `states.ts` holds the allowed moves; `moveTrade` refuses any other and writes every move to the audit log in the same transaction as the change.

### Circuit breakers

The monitor pauses new trading, with no model involved, on: daily loss limit, drawdown limit, consecutive losses, exposure above the allocation, an open position with no price for five minutes, three market-data failures in a row, three failed simulations in a row, a fill that slipped more than twice the mandate's limit, or any state it cannot read. Pausing never stops protective exits. Resuming is manual and restarts the loss streak and the drawdown high-water mark from current equity.

### Emergency controls

| Control | Exactly what it does |
| --- | --- |
| Pause agent | No new positions from this moment. Stops, targets and time limits keep running on open positions. |
| Close all positions | Pauses the agent, then sells every open position at the current market price. A position with no current price is not closed at an invented one: it stays open under its stop, and the user is told. |
| Revoke trading access | Stops the agent and removes `PROPOSE_TRADE` and `EXECUTE_TRADE`. Open positions stay protected. Starting again takes a fresh review and approval of the whole form. |
| Revoke trading authority (wallet) | No agent using that wallet can open a position until it is restored. |
| Withdraw funds | Opens the wallet's withdrawal form. Only the signed-in user can move funds out. |

The kill switch is read at the last possible moment: the final check re-reads the agent and wallet inside the locked transaction, so a pause or revoke that lands after a proposal was approved still stops it.

## Paper Mode

Paper Mode uses live market data and the same strategy, risk engine, monitor and state machine as Live would. Only the fill is modelled:

- **Price impact** assumes a constant-product pool holding the reported liquidity. Concentrated liquidity usually moves less, so this errs on the costly side.
- **Swap fee** is assumed to be 0.3% of the amount traded.
- **Network fee** is the chain's current gas price times an assumed 350,000 gas, at the current ETH price. If either cannot be read, check 16 fails and nothing is traded.
- **Exits always fill**, at the modelled impact (capped at 90% below market) or an assumed 25% below market when the pool's depth is unknown, so thin markets look as bad on paper as they are.

These are assumptions, not measurements. Paper results are an estimate of what Live would have done.

## Wallets

A trading wallet is a key generated (or imported) on the server and stored encrypted with AES-256-GCM under a key that is separate from the one protecting API keys and connection secrets (`TRADING_WALLET_SECRET`, or a separately derived key from `APP_SECRET` when that is unset).

- The key is read in exactly one place, `withdraw()` in `wallets.ts`, for a transfer the signed-in user asked for. The transfer is simulated against the chain first.
- The trading engine, the monitor and every agent tool do not import the wallet service. Nothing in the trading path can sign.
- Balances (ETH and USDG) are read live from Robinhood Chain. When the chain cannot be read the balance is shown as unavailable, never guessed.
- A wallet cannot be removed, and an account cannot be deleted, while a wallet holds ETH or USDG or its balance cannot be checked. Other tokens are not checked.

**Paper Mode needs no deposit.** The allocation is simulated capital. The page says so wherever a deposit address is shown.

## Security checklist

| Rule from the plan | How it holds | Evidence |
| --- | --- | --- |
| 1. Keys never reach the model | The prompt is built from the mandate, portfolio numbers and market data only. `proposal.ts` and `engine.ts` do not import the wallet service. | integration test 12 |
| 2. Model cannot bypass the risk engine | The only path to `executeEntry` runs both risk stages. The model returns text and nothing else. | tests 2, 3 |
| 3. Every trade passes deterministic validation | `executeEntry` runs the final check itself. There is no parameter to skip it. | test 1 |
| 4. Simulate before signing | Paper fills are simulated by definition. Withdrawals are simulated on the chain before they are signed. | wallet tests |
| 5. Hard capital allocation | Checks 2–4, run under a per-agent database lock so concurrent fills cannot both pass. | test 2 (concurrency) |
| 6. Immediate kill switch | Pause, close all, revoke; re-read inside the execution transaction. | test 9 |
| 7. Breakers run outside the model | `monitor.ts` never calls a model. | tests 6, 8 |
| 8. Monitoring survives model outages | Same. The monitor's only dependencies are the database and market data. | test 6 |
| 9. Configuration versioned and auditable | Mandate, strategy and config versions; `config.changed` events with the diff. | test 10 |
| 10. Uncertain state stops trading | Fail-closed checks; breakers on unreadable state, stale prices and failing providers. | unit tests, test 8 |
| 11. API auth and signing authority separate | Different encryption keys; the Accred API key cannot sign and the wallet key cannot call the API. | wallet tests |
| 12. Paper and Live share risk logic | One `evaluateRisk`. Mode is an input to check 1, nothing else. | by construction |
| 13. Never log signing secrets | `audit()` drops secret-named fields at any depth; wallet errors show only their own messages. | test 12, wallet tests |
| 14. Never silently raise permissions or allocation | Profits are not redeployed; raises go through `riskIncreases`. | unit tests |
| 15. Risk-increasing changes need approval | Server-side refusal without the named confirmation. | unit tests |
| 16. Idempotent execution | Unique `executions.idempotency_key` (`entry:<proposal>`, `exit:<position>:<n>`), state re-read under the lock. | test 5 |

Test numbers refer to `src/lib/trading/integration.test.ts`. Unit tests are in `core.test.ts` and `core2.test.ts`; wallet tests in `wallets.test.ts`.

## What blocks Live Mode

The plan's Definition of Done, item by item:

| Requirement | State |
| --- | --- |
| Paper Mode works end to end | Done |
| Risk engine has boundary and failure tests | Done |
| Allocation cannot be bypassed | Done for paper fills, including under concurrency |
| Stop loss and circuit breakers are tested | Done |
| Provider failures fail safely | Done |
| Duplicate execution protection | Done |
| Secrets encrypted and excluded from logs | Done |
| Kill switch works | Done |
| Position monitor survives restart | Done (it holds no state in memory) |
| Executions have complete audit trails | Done |
| User can revoke access and withdraw | Built. **Withdrawal has only been tested against a mocked chain, never with real funds on mainnet.** |
| Transaction simulation works | **Not done for trades.** Paper fills are modelled, not simulated onchain |
| Wallet and signing architecture has a security review | **Not done** |

Unresolved items that need a decision or a review before any live trade:

1. **No swap execution exists anywhere in Accred.** `accred-api` has a Uniswap v3 quoter (`internal-router.ts`) but never executes a swap. Routing (most volume on the chain is Uniswap v4, then v3), approvals, transaction building and receipt handling all have to be built.
2. **Onchain quotes and simulation.** Live needs a real quote (QuoterV2 or an aggregator) and an `eth_call`/`simulateContract` of the exact transaction, replacing the paper model behind the same `RiskQuote` shape.
3. **Signing design.** Today the server holds the key. That is acceptable for user-requested withdrawals but is the wrong shape for autonomous trading. The plan prefers permission-limited signing: a smart account or session key whose onchain policy caps spend, restricts targets to the swap router and allowlisted tokens, and can be revoked onchain. Nothing like this exists in the Accred repos yet. Until it does, "allocation cannot be bypassed" is enforced by this server only.
4. **Key custody review.** How `TRADING_WALLET_SECRET` is stored and rotated, who can read the database, backups, and whether a KMS or HSM should hold the wrapping key.
5. **The quote asset.** Paper positions are sized in dollars. Live has to decide what the agent spends (USDG or WETH), how the allocation is measured when ETH moves, and how gas is funded.
6. **Real-fill behaviour.** Partial fills, reverts, stuck transactions, reorgs and MEV are not modelled. The state machine has `EXECUTING → FAILED` but live recovery (did the transaction land?) needs the chain as the source of truth.
7. **Reconciliation.** In Live, wallet balances and positions must be checked against the chain on every tick, with a mismatch tripping the "inconsistent wallet state" breaker. In Paper there is nothing onchain to reconcile.
8. **Market-data trust and limits.** One provider (DexScreener) prices everything, through its public, rate-limited API. From a shared host those limits can be hit by other tenants; when they are, cycles are skipped and, after three failures or five minutes without a price on an open position, the agent pauses. Live should use a keyed data source and confirm against a second one or the pool itself before trading, as `accred-api` does for credit purchases.
9. **RPC.** The public Robinhood Chain endpoints are rate limited. Set `ROBINHOOD_RPC_URL` to a dedicated provider before real volume.
10. **Legal and compliance review** of offering automated trading and holding user keys.
11. **Withdrawals need one supervised run with real funds** on mainnet, ETH and USDG, including "Max".

## Running it

Nothing new is required. Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `TRADING_WALLET_SECRET` | 32+ characters. Encrypts wallet keys. Set it before the first wallet is created and never change it: doing so makes every stored wallet key unreadable. Without it, a key derived from `APP_SECRET` is used. |
| `ROBINHOOD_RPC_URL` | An HTTPS RPC endpoint tried before the public ones. |

The scheduler starts cycles and a separate 20-second timer runs the position monitor, both inside the server process. With `SCHEDULER=off`, `/api/cron/tick` runs the monitor and starts due cycles; call it every minute.

Tests:

```bash
pnpm test                       # unit tests; database tests are skipped
createdb accred_automation_trading
DATABASE_URL=postgres://localhost:5432/accred_automation_trading pnpm db:migrate
TRADING_TEST_DATABASE_URL=postgres://localhost:5432/accred_automation_trading pnpm test
```

Local development without credits: `pnpm mock:accred` now also plays a trading model. It buys the first candidate inside the limits and adds one oversized proposal so a rejection is visible. `MOCK_TRADING=none` proposes nothing; `MOCK_TRADING=rogue` proposes an asset that is not on the allowlist.
