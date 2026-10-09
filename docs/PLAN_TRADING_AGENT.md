# Plan: Trading Agents

**Status:** Built on the `trading-agent` branch. Not yet run with real funds. No security review yet.
**Last updated:** 2026-10-06
**Repo:** `accred-automation` (the app behind agent.accred.sh)

This is the product and engineering plan for trading agents: what the feature is, the rules it must never break, and the order to build it in. It is the specification. [TRADING_AGENT.md](./TRADING_AGENT.md) describes what was actually built and is the source of truth for the code as it stands.

**One sentence:** the user gives the agent a mandate, not their wallet.

---

## Contents

1. [Objective](#1-objective)
2. [Where the build stands](#2-where-the-build-stands)
3. [Setup flow](#3-setup-flow)
4. [Wallet and authorization](#4-wallet-and-authorization)
5. [Trading mandate](#5-trading-mandate)
6. [Risk controls](#6-risk-controls)
7. [Risk profiles](#7-risk-profiles)
8. [Strategy](#8-strategy)
9. [Architecture](#9-architecture)
10. [Deterministic risk engine](#10-deterministic-risk-engine)
11. [Trade state machine](#11-trade-state-machine)
12. [Position monitoring](#12-position-monitoring)
13. [Paper Mode](#13-paper-mode)
14. [Decision transparency](#14-decision-transparency)
15. [Live dashboard](#15-live-dashboard)
16. [Emergency controls](#16-emergency-controls)
17. [Circuit breakers](#17-circuit-breakers)
18. [Connections and notifications](#18-connections-and-notifications)
19. [Audit log](#19-audit-log)
20. [Backend modules](#20-backend-modules)
21. [Data models](#21-data-models)
22. [Scheduling](#22-scheduling)
23. [Accred credit integration](#23-accred-credit-integration)
24. [Permission model](#24-permission-model)
25. [UX principle](#25-ux-principle)
26. [Roadmap](#26-roadmap)
27. [Non-negotiable rules](#27-non-negotiable-rules)
28. [Definition of done for live release](#28-definition-of-done-for-live-release)
29. [Implementation guidelines](#29-implementation-guidelines)

---

## 1. Objective

Build a web-based autonomous trading system inside Accred where a user:

1. connects a dedicated wallet,
2. allocates a limited amount of capital,
3. defines strict risk rules,
4. lets an AI agent trade supported assets on Robinhood Chain.

The AI may research markets and propose trades. Deterministic backend controls must approve every trade before funds move.

**Critical invariant:** even if the model hallucinates, is prompt-injected, behaves incorrectly, or proposes an oversized or malicious trade, the deterministic authorization and risk layers must prevent it from exceeding the user's explicit mandate.

---

## 2. Where the build stands

A summary as of 2026-10-06, taken from [TRADING_AGENT.md](./TRADING_AGENT.md). Read that document for detail.

| Area of the plan | State |
| --- | --- |
| Mandate, strategy, permissions, versioning | Built |
| Deterministic risk engine, 17 checks | Built, with boundary and failure tests |
| Live execution on Robinhood Chain mainnet, simulated before signing | Built. Verified by simulation against mainnet state. **No real trade sent yet** |
| Position monitor, protective exits, circuit breakers | Built |
| Dedicated wallets, deposit, withdraw | Built. Withdrawals not yet run with real funds |
| Emergency controls | Built |
| Audit log and notifications | Built |
| Paper Mode | **Retired.** See below |
| Session keys, smart accounts, on-chain spending limits (Phase 4) | Not built |
| Security review of key custody and signing | **Not done** |

**One deliberate departure from this plan.** The plan requires Paper Mode before Live Mode (section 13). On 2026-10-06 the product owner decided that agents trade with real funds on mainnet only, and Paper Mode was retired. Its fill model survives only as a test fixture. The sections below still describe Paper Mode as the plan originally specified it.

---

## 3. Setup flow

Creating a trading agent takes eleven steps:

1. New Automation → Trading Agent
2. Choose the AI model
3. Create or import a dedicated trading wallet
4. Deposit funds
5. Set the maximum Agent Allocation
6. Configure the strategy
7. Configure the risk mandate
8. Select assets and markets
9. Choose Paper or Live Mode
10. Review permissions and limits
11. Explicitly approve and start

**Example.** The wallet holds $5,000 and the agent allocation is $1,000. The agent must never touch the remaining $4,000.

---

## 4. Wallet and authorization

Prefer a dedicated agent wallet over the user's primary wallet.

The wallet feature must support:

- Create wallet
- Import wallet
- Deposit and withdraw
- Live balances
- Wallet balance shown separately from agent allocation
- Revoke trading authority
- Emergency withdrawal

Rules:

- Keep Accred and model API authentication completely separate from wallet signing authority.
- Prefer a permission-limited design (session keys or a smart account) where possible.
- Never expose raw private keys or seed phrases to the LLM, prompts, logs, analytics, or agent tools.

---

## 5. Trading mandate

Every agent receives a machine-enforced mandate. These are hard backend constraints, not suggestions to the model.

```json
{
  "mode": "paper",
  "agentAllocationUsd": 1000,
  "maxPositionUsd": 100,
  "maxPositionPercent": 10,
  "maxOpenPositions": 3,
  "maxTradesPerDay": 8,
  "maxLossPerTradePercent": 2,
  "dailyLossLimitPercent": 5,
  "maxDrawdownPercent": 10,
  "stopLossRequired": true,
  "defaultStopLossPercent": 2,
  "defaultTakeProfitPercent": 5,
  "minimumRiskReward": 2,
  "maxSlippagePercent": 1,
  "minimumLiquidityUsd": 50000,
  "cooldownAfterLossMinutes": 30,
  "maxConsecutiveLosses": 3,
  "allowedNetwork": "robinhood-chain",
  "allowedAssets": [],
  "blockedAssets": [],
  "tradingEnabled": true
}
```

| Field | Example | Meaning |
| --- | --- | --- |
| `mode` | `"paper"` | Paper or Live |
| `agentAllocationUsd` | `1000` | The most capital the agent may use, in dollars |
| `maxPositionUsd` | `100` | Largest single position, in dollars |
| `maxPositionPercent` | `10` | Largest single position, as a percentage of the allocation |
| `maxOpenPositions` | `3` | Most positions open at once |
| `maxTradesPerDay` | `8` | Most trades in one day |
| `maxLossPerTradePercent` | `2` | Largest planned loss on one trade |
| `dailyLossLimitPercent` | `5` | Loss in one day that stops new trading |
| `maxDrawdownPercent` | `10` | Portfolio drawdown that stops new trading |
| `stopLossRequired` | `true` | Every position must have a stop loss |
| `defaultStopLossPercent` | `2` | Stop loss used when the proposal gives none |
| `defaultTakeProfitPercent` | `5` | Take profit used when the proposal gives none |
| `minimumRiskReward` | `2` | Lowest acceptable reward-to-risk ratio |
| `maxSlippagePercent` | `1` | Most slippage a trade may accept |
| `minimumLiquidityUsd` | `50000` | Least market liquidity an asset must have |
| `cooldownAfterLossMinutes` | `30` | Wait after a losing trade before the next one |
| `maxConsecutiveLosses` | `3` | Losses in a row that stop new trading |
| `allowedNetwork` | `"robinhood-chain"` | The only network the agent may trade on |
| `allowedAssets` | `[]` | Assets the agent may trade |
| `blockedAssets` | `[]` | Assets the agent may never trade |
| `tradingEnabled` | `true` | Master switch for the agent |

---

## 6. Risk controls

| Group | Controls |
| --- | --- |
| **Capital** | Total agent allocation · Max capital or percentage per trade · Max total open exposure · Max simultaneous positions · Untouchable reserve balance |
| **Loss** | Max loss per trade · Daily realized and total loss limit · Max portfolio drawdown · Max consecutive losses · Cooldown after losses |
| **Position** | Mandatory stop loss · Default and maximum stop-loss distance · Take profit · Minimum risk/reward · Trailing stop · Break-even trigger · Partial profit-taking · Max position lifetime |
| **Execution** | Max slippage · Minimum liquidity · Minimum market cap and token age · Max price impact · Max network fee · Mandatory simulation · Quote-expiry protection |
| **Assets and time** | Allowlist and blocklist · Network and venue restriction · Custom trading hours · Max trades per hour and per day · Cooldown between trades |

---

## 7. Risk profiles

Offer four presets: **Conservative**, **Balanced**, **Aggressive** and **Custom**.

A preset only fills in the visible mandate. There are no hidden rules behind it.

---

## 8. Strategy

Support two kinds of strategy input:

- **Structured strategies:** momentum, breakout, trend following, mean reversion, volume expansion.
- **Natural-language instructions**, for example:

  > Trade momentum opportunities on Robinhood Chain. Avoid illiquid assets. Risk no more than 1.5% per position. Take partial profit at +5% and move the stop to breakeven.

A natural-language strategy can never override the Trading Mandate.

---

## 9. Architecture

```text
Market Data
  ↓
Agent Research / Reasoning
  ↓
Structured Trade Proposal
  ↓
Deterministic Risk Engine
  ↓
Quote + Transaction Simulation
  ↓
Final Pre-Trade Check
  ↓
Execution Engine
  ↓
Position Monitor
  ↓
Exit / TP / SL
  ↓
Audit Log + Notifications
```

The LLM proposes. It never directly signs arbitrary transactions.

A proposal is structured data:

```json
{
  "action": "BUY",
  "asset": "TOKEN",
  "requestedPositionUsd": 75,
  "entryReason": "Momentum and volume expansion",
  "stopLossPercent": 2,
  "takeProfitPercent": 5,
  "confidence": 0.82
}
```

Treat all model output as untrusted input and validate it against a schema.

---

## 10. Deterministic risk engine

Before any execution, verify all seventeen checks:

| # | Check |
| --- | --- |
| 1 | Trading enabled |
| 2 | Allocation available |
| 3 | Position-size limit |
| 4 | Total exposure limit |
| 5 | Open-position limit |
| 6 | Trade-frequency limit |
| 7 | Daily loss limit |
| 8 | Drawdown limit |
| 9 | Consecutive-loss circuit breaker |
| 10 | Asset permitted and not blocked |
| 11 | Liquidity and market filters |
| 12 | Valid stop loss |
| 13 | Minimum risk/reward |
| 14 | Slippage and price impact |
| 15 | Transaction simulation |
| 16 | Network fee |
| 17 | Fresh quote immediately before execution |

Any failure rejects the trade. The LLM cannot override a rejection.

---

## 11. Trade state machine

Persist every transition, for auditing and for recovery.

| State | Meaning |
| --- | --- |
| `DISCOVERED` | A candidate was found by the market scan |
| `PROPOSED` | The model proposed a trade |
| `RISK_REJECTED` | The risk engine refused it |
| `APPROVED` | The risk engine approved it |
| `SIMULATED` | The quote and transaction simulation passed |
| `EXECUTING` | The trade is being sent |
| `OPEN` | The position is open |
| `PARTIAL_EXIT` | Part of the position has been sold |
| `CLOSED` | The position is fully closed |
| `FAILED` | Execution failed |
| `CANCELLED` | The trade was cancelled before execution |

---

## 12. Position monitoring

Backend services, not the LLM, must continuously enforce:

- stop loss,
- take profit,
- trailing stop,
- position timeout,
- exposure limits.

Protective exits must keep working during model or API outages.

---

## 13. Paper Mode

> Retired in the build on 2026-10-06. See [section 2](#2-where-the-build-stands). This section records the plan as written.

Paper Mode is required before Live Mode. It uses the same strategy and the same risk engine, with no signing.

Track for each paper agent:

- hypothetical PnL,
- win rate,
- max drawdown,
- average win and average loss,
- risk/reward,
- proposals made,
- trades rejected and the reasons,
- fees and slippage.

Flow: **Run Paper Mode → Review Results → Explicitly Go Live**

---

## 14. Decision transparency

Show every decision, including rejected trades.

An executed trade:

```text
BUY — TOKEN
Confidence             82%
Requested position     $75
Agent allocation       $1,000
Entry                  $0.420
Stop loss              $0.4116
Take profit            $0.441
Maximum planned loss   $1.50
Reason                 Momentum + volume expansion
Risk checks            17/17 passed
Status                 Executed
```

A rejected trade:

```text
SKIPPED — TOKEN
Liquidity              $31,400
Required minimum       $50,000
Risk Engine            Rejected automatically
```

---

## 15. Live dashboard

The dashboard shows:

- the agent and its model,
- Paper or Live status,
- Running or Paused status,
- the kill switch,
- allocation and available capital,
- exposure,
- PnL: realized, unrealized, daily and total,
- drawdown,
- open positions with their stop loss and take profit,
- an activity timeline.

---

## 16. Emergency controls

Always visible in Live Mode. The behavior of each action must be clearly defined.

| Control | Behavior |
| --- | --- |
| **Pause Agent** | Stops new positions. Protective monitoring continues. |
| **Close All Positions** | Closes every open position. |
| **Revoke Trading Access** | Removes the agent's authority to trade. |
| **Withdraw Funds** | Moves funds out of the trading wallet. |

The exact behavior of each control as built is in the "Emergency controls" table of [TRADING_AGENT.md](./TRADING_AGENT.md).

---

## 17. Circuit breakers

Automatically pause new trading on any of these:

- daily-loss limit reached,
- drawdown limit reached,
- consecutive-loss limit reached,
- stale market data,
- provider instability,
- repeated simulation failures,
- abnormal slippage,
- inconsistent wallet state,
- risk-engine uncertainty.

**Default rule: fail closed. If safety cannot be determined, do not trade.**

---

## 18. Connections and notifications

Use Accred Connections for delivery: Telegram, Slack, Discord, Email, X where appropriate, and webhooks.

Notify the user about:

- executions,
- rejections,
- stop-loss and take-profit exits,
- loss limits reached,
- automatic pauses,
- failures,
- manual stops.

A messaging connection must never automatically grant trading authority.

---

## 19. Audit log

Record:

- timestamps,
- the model used,
- the proposal and a summary of its reasoning,
- a reference to the market data used,
- risk inputs and the result of each check,
- the quote,
- the simulation,
- the transaction hash,
- position changes and exits,
- PnL,
- configuration changes,
- pause and resume events.

Never log private keys, seed phrases, passwords or signing secrets.

---

## 20. Backend modules

| Module | Responsibility |
| --- | --- |
| `automation-service` | Create and manage trading automations |
| `agent-runner` | Run one agent cycle |
| `market-data-service` | Prices, liquidity and market data |
| `strategy-engine` | Screen candidates and shape proposals |
| `risk-engine` | The deterministic checks |
| `quote-service` | Fetch quotes for a trade |
| `transaction-simulator` | Simulate a transaction before signing |
| `execution-service` | Sign and send trades |
| `position-monitor` | Enforce exits on open positions |
| `wallet-service` | Wallets, balances, signing keys |
| `notification-service` | Send notifications through Connections |
| `audit-service` | Write the audit log |
| `scheduler` | Decide when agents and monitors run |

The risk and execution layers must stay independent of LLM-generated code.

Where each module lives in the code is listed under "Where the plan's modules live" in [TRADING_AGENT.md](./TRADING_AGENT.md).

---

## 21. Data models

Create and version these models:

- `TradingAutomation`
- `TradingWallet`
- `RiskMandate`
- `Strategy`
- `TradeProposal`
- `RiskEvaluation`
- `Execution`
- `Position`
- `AgentRun`
- `AuditEvent`

Every executed trade must reference the exact `RiskMandate` version that approved it.

---

## 22. Scheduling

Support four ways to run an agent: continuous, interval-based, scheduled, and within a trading window.

Run cheap deterministic market filters before invoking the LLM. This cuts latency and LLM credit use.

```text
Market Scanner → Candidate Filter → Agent → Proposal → Risk Engine → Execution
```

---

## 23. Accred credit integration

For each agent and each run, show:

- the model,
- input and output tokens,
- LLM credits charged,
- trading PnL,
- network fees,
- net performance after costs.

Example:

```text
Gross trading PnL      +$14.82
Network fees            -$0.31
LLM cost                -$0.47 equivalent
Net result             +$14.04
```

---

## 24. Permission model

Permissions are granular. Sensitive permissions require explicit user approval.

| Permission | Allows |
| --- | --- |
| `READ_MARKET_DATA` | Read prices and market data |
| `READ_BALANCE` | Read wallet balances |
| `PROPOSE_TRADE` | Propose a trade to the risk engine |
| `EXECUTE_TRADE` | Execute an approved trade |
| `CLOSE_POSITION` | Close an open position |
| `MANAGE_PROTECTIVE_ORDERS` | Set and change stop loss and take profit |
| `SEND_NOTIFICATION` | Send notifications through Connections |

---

## 25. UX principle

Do not position the product as "give AI your wallet."

Position it as:

> **Define exactly how your agent can trade.**

Emphasize:

- user-controlled allocation,
- hard limits,
- transparent decisions,
- simulation,
- revocable permissions,
- emergency controls,
- complete history.

---

## 26. Roadmap

| Phase | Name | Scope |
| --- | --- | --- |
| 1 | **Safe Foundation** | Dedicated wallet, deposit and withdraw, allocation, Paper Mode, market data, structured proposals, deterministic risk engine, audit log, dashboard, manual start and stop. No autonomous live execution. |
| 2 | **Controlled Live Trading** | Robinhood Chain execution, mandatory simulation, position monitor, stop loss and take profit, loss and drawdown limits, emergency controls, notifications, and an initially restricted set of markets and assets. |
| 3 | **Advanced Automation** | Trailing stops, partial exits, schedules, advanced filters, natural-language strategies, multiple agents, analytics. |
| 4 | **Permissioned Infrastructure** | Explore session keys, smart accounts, on-chain spending limits, revocable agent permissions, strategy templates, multi-wallet portfolios. |

---

## 27. Non-negotiable rules

1. Never expose private keys or seed phrases to the LLM.
2. The LLM cannot bypass the risk engine.
3. Every live trade passes deterministic validation.
4. Simulate transactions before signing where supported.
5. Every agent has a hard capital allocation.
6. Every live agent has an immediate kill switch.
7. Loss and drawdown breakers run outside the LLM.
8. Protective monitoring survives model outages.
9. Configuration is versioned and auditable.
10. Uncertain system state means stop trading.
11. API authentication and signing authority remain separate.
12. Paper and Live use the same risk logic.
13. Never log signing secrets.
14. Never silently increase permissions or allocation.
15. Risk-increasing changes require explicit approval.
16. Execution must be idempotent to prevent duplicate trades.

How each rule holds in the code is in the "Security checklist" of [TRADING_AGENT.md](./TRADING_AGENT.md).

---

## 28. Definition of done for live release

Do not ship autonomous Live Mode until every item is true:

- [ ] Paper Mode works end to end
- [ ] The risk engine has boundary and failure tests
- [ ] The allocation cannot be bypassed
- [ ] Stop loss and circuit breakers are tested
- [ ] Transaction simulation works
- [ ] Provider failures fail safely
- [ ] Duplicate execution protection exists
- [ ] Secrets are encrypted and excluded from logs
- [ ] The kill switch works
- [ ] The position monitor survives a restart
- [ ] Executions have complete audit trails
- [ ] The user can revoke access and withdraw
- [ ] The wallet and signing architecture has had a security review

The boxes are left unticked on purpose: this is the plan's checklist, not a sign-off. "What has and has not been verified" in [TRADING_AGENT.md](./TRADING_AGENT.md) lists what is proven today and what is still open. Two items are known to be open: Paper Mode was retired rather than shipped, and the security review has not happened.

---

## 29. Implementation guidelines

For whoever builds or extends this, person or coding agent:

1. Inspect the existing Accred repository and architecture first.
2. Reuse the current auth, credits, models, Automation, Connections and design-system components.
3. Do not rewrite working infrastructure unnecessarily.
4. Produce an architecture proposal before large code changes.
5. Inspect the existing Robinhood Chain wallet and execution infrastructure before adding transaction code.
6. Implement Paper Mode and the deterministic risk engine before autonomous Live Mode.
7. Never put signing material in prompts or logs.
8. Treat LLM output as untrusted and validate it against a schema.
9. Implement execution idempotency.
10. Add tests for every risk boundary and failure path.
11. Preserve Accred's existing visual language.
12. Do not invent unsupported APIs or chain functionality. Document blockers instead.
13. Before Live Mode, produce a security checklist and a list of unresolved review items.
