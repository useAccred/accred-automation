# Plan: Accred Automation (automation.accred.sh)

**Status:** MVP built and running locally. Not committed, not deployed.
**Last updated:** 2026-10-06
**Repo:** `accred-automation` (Next.js 16, React 19, Drizzle, PostgreSQL)

This document describes what is built today, how it works, what is missing, and the order to finish it in. It is written from the code as it stands on the date above. The README covers setup; this covers the plan.

---

## 1. What we are building

A hosted app where a user:

1. signs in with their Accred API key,
2. connects the apps an agent may use (Telegram, Slack, Discord, GitHub, any HTTP API),
3. describes a job in plain words and picks a trigger (schedule, webhook, or manual),
4. gets a step-by-step log of every run with the exact credits each step cost.

Every model call is paid from the user's own Accred credits through their key. The app adds no fee of its own. A run can never spend more than the budget the user set for it.

**One sentence:** describe a job once, and an agent runs it on a schedule and shows a receipt for every credit it spent.

---

## 2. Status at a glance

| Area | State | Notes |
| --- | --- | --- |
| Landing page, login, dashboard | Built | `src/app/page.tsx`, `src/app/login`, `src/app/app` |
| Sign in with an Accred API key | Built | Key is checked without spending credit, stored encrypted |
| Connections: Telegram, Slack, Discord, GitHub, HTTP | Built | Each is tested before it is saved |
| Telegram one-click linking through a shared bot | Built | Needs `TELEGRAM_BOT_TOKEN`; long polling |
| Create, edit, pause, delete automations | Built | Six starter templates |
| Agent loop over the JSON protocol | Built | Budget checks, approval pause, transcript compaction |
| Model routing (Auto, Economy, Best quality, One model) | Built | Resolves against the live catalog |
| Triggers: manual, schedule, webhook | Built | Internal scheduler or external cron |
| Run log with per-step credits | Built | Auto-refreshes while a run is active |
| Live credit balance on the dashboard | Built | Falls back to the last reported balance |
| Mock Accred API for local work | Built | `pnpm mock:accred`, port 4010 |
| Unit tests | 19 passing | Typecheck and lint are clean |
| Git history | **Not done** | Only the Create Next App commit exists; all work is uncommitted, no remote |
| Database migrations | **Not done** | `db:push` only; no `drizzle/` folder |
| Deployment | **Not done** | No host, DNS or secrets set up yet |
| Sign in with the Accred account (Privy) | Not built | |
| OAuth connections (Gmail, Calendar, Notion) | Not built | Shown as "coming soon" in the UI |
| Approve from Telegram or email | Not built | Approval is web only |
| Native tool calling | Blocked | The Accred API is text only today |

---

## 3. Flows

### Sign in

```text
User pastes API key
  → rate limit: 8 attempts per minute per IP
  → POST /api/customer/v1/chat/completions with an empty body
      400 = key is good, 401/403 = key is bad, anything else = try again later
  → user row found or created by SHA-256 of the key
  → key stored with AES-256-GCM, last 4 characters kept as a hint
  → 30-day session cookie (httpOnly, sameSite=lax)
```

The key is the account. Replacing the key in Settings keeps the same account; a key that already belongs to another account is refused.

### Create an automation

The form collects: name, instruction (10 to 4,000 characters), trigger, timezone, up to one connection of each type, model mode, credit budget per run (0.1 to 1,000), monthly cap (at least the per-run budget), and whether write actions need approval (on by default).

### A run

```text
Trigger (manual button, scheduler tick, or webhook POST)
  → createRun: budget = min(per-run budget, what is left of the monthly cap)
      nothing left this month → run recorded as stopped_budget, never started
  → executeRun: status queued → running
  → loop:
      1. shrink the transcript if it is over 27 KB
      2. price the worst case of the next call; switch to the cheap model or stop if it does not fit
      3. call the planner model, parse one JSON object
      4. "final" → succeeded
         "tool"  → validate arguments
                   write tool and approval on → pause as waiting_approval
                   otherwise run the tool, condense long output, feed the result back
  → every step is written to run_steps with model, tokens, credits and duration
```

### Approval

A paused run stores its transcript in `runs.state`. When the user approves or declines on the run page, the run is claimed back to `running` and continues from where it stopped. A declined action is reported to the model as rejected, and the model is told to finish without retrying it.

---

## 4. Architecture

```text
Browser
  │  server actions (src/app/actions.ts)
  ▼
Next.js server (one long-running Node process)
  ├─ pages            src/app/**                    dashboard, automations, runs, connections, settings
  ├─ webhook route    src/app/api/hooks/[token]     starts a run from an outside POST
  ├─ cron route       src/app/api/cron/tick         lets an external cron drive the scheduler
  ├─ scheduler        src/lib/scheduler.ts          30-second interval, started in instrumentation.ts
  ├─ telegram poller  src/lib/telegram.ts           long polling for the shared bot
  └─ agent            src/lib/agent/
       protocol.ts    prompt, reply parsing
       router.ts      model tiers and worst-case pricing
       runner.ts      the loop, budget, approval, persistence
       tools.ts       tool registry and connection tests
       safe-fetch.ts  outbound HTTP that refuses private addresses
       extract.ts     HTML and feed to text
  │
  ├──► PostgreSQL (Drizzle)        users, sessions, connections, automations, runs, run_steps, telegram_links
  ├──► Accred API (accred SDK)     models, chat completions, balance
  └──► Outside services            Telegram, Slack, Discord, GitHub, user HTTP APIs, public web
```

Runs execute inside the server process and continue after the request that started them (`after()` for manual and webhook runs, a detached promise for scheduled ones). This is why the app must run as a long-lived server and not as serverless functions.

---

## 5. The agent loop in detail

### Protocol

The Accred API is text in, text out. Each model reply must be exactly one JSON object:

```json
{"thought": "one short sentence", "tool": "web.fetch", "args": {"url": "https://…"}}
{"thought": "one short sentence", "final": "what was done, in 1 to 4 sentences"}
```

The parser takes the first balanced JSON object in the reply, so prose or code fences around it are tolerated. A reply with both `tool` and `final`, or neither, is sent back with a format reminder. Only the parsed reply is kept in the transcript, never the raw text.

### Model routing

| Mode | Planner (decides each step) | Reader (condenses long output) |
| --- | --- | --- |
| Auto | smart tier | fast tier |
| Economy | fast tier | fast tier |
| Best quality | top tier | smart tier |
| One model | the pinned model | the pinned model |

Each tier tries a list of known model IDs in order, then falls back to the catalog model whose output price is closest to the tier's target ($10, $3 and $25 per million output tokens). `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL` and `ROUTER_TOP_MODEL` override a tier. Batch, free, image, audio and embedding variants are filtered out.

### Limits

| Limit | Value | Where |
| --- | --- | --- |
| Tool calls per run | 10 | `runner.ts` |
| Model calls per run | 16 | `runner.ts` |
| Format errors in a row before failing | 3 | `runner.ts` |
| Planner output allowance | 1,200 tokens | `runner.ts` |
| Reader output allowance | 700 tokens | `runner.ts` |
| Tool output passed inline | 5,000 bytes; larger output is condensed | `runner.ts` |
| Reader input | 18,000 bytes | `runner.ts` |
| Transcript size | 27,000 bytes | `runner.ts` |
| Trigger payload shown to the model | 6,000 bytes | `runner.ts` |
| Saved memory | 2,000 characters | `runner.ts` |
| Shortest schedule interval | 5 minutes | `schedule.ts` |
| Webhook body | 64 KB, 30 requests per minute per token | `api/hooks/[token]` |
| Fetched page size | 1.5 MB, 25-second timeout, 5 redirects | `safe-fetch.ts` |

### Budget

Before each model call the runner prices the worst case: estimated input tokens (characters ÷ 3, plus 16) and the full output allowance. If that could pass the run's budget:

1. if the reader model is cheaper and fits, the run switches to it for the rest of the run and logs a note;
2. otherwise the run ends as `stopped_budget`.

Credits are tracked in integer microcredits (1 credit = 1,000,000; 100 credits = $1). Charges round up, balances round down.

### Run states

`queued` → `running` → `succeeded` | `failed` | `stopped_budget` | `cancelled`, with `waiting_approval` as a pause between `running` states.

---

## 6. Tools

| Tool | Needs | Effect | What it does |
| --- | --- | --- | --- |
| `web.fetch` | nothing | read | Fetches a public page, JSON API or feed and returns text |
| `memory.save` | nothing | internal | Replaces the note the job keeps between runs |
| `telegram.send_message` | Telegram | write | Sends plain text, up to 4,000 characters |
| `slack.post_message` | Slack | write | Posts to the webhook's channel |
| `discord.post_message` | Discord | write | Posts up to 2,000 characters, mentions disabled |
| `github.search` | GitHub | read | Searches issues and pull requests in the linked repository |
| `github.get_issue` | GitHub | read | Reads one issue or pull request with its last 10 comments |
| `github.comment` | GitHub | write | Comments on an issue or pull request |
| `github.add_labels` | GitHub | write | Adds labels |
| `github.create_issue` | GitHub | write | Opens an issue |
| `http.request` | HTTP API | GET is read, other methods are write | Calls a path under the connection's base URL |

Write tools pause for approval unless the automation turns approval off. An automation only sees the tools of the connections linked to it.

---

## 7. Data model

| Table | Purpose | Key fields |
| --- | --- | --- |
| `users` | One per API key | `key_hash`, `key_enc`, `key_hint`, last known balance and its source |
| `sessions` | Login sessions | `token_hash`, `expires_at` |
| `connections` | Linked apps | `kind`, `config_enc` (all fields, encrypted), `display` (non-secret fields) |
| `telegram_links` | One-time codes for the shared bot | `code`, `expires_at` (15 minutes) |
| `automations` | Jobs | instruction, trigger, cron, timezone, `webhook_token`, `connection_ids`, model mode, both caps, `require_approval`, `memory`, `next_run_at` |
| `runs` | One execution | status, trigger, payload, `credits_micro`, `budget_micro`, planner and reader model, result, error, `state` (transcript while paused) |
| `run_steps` | Log lines of a run | kind (decision, tool, condense, approval, note), model, tool, args, credits, tokens, duration |

Everything cascades from `users`, so deleting an account removes all of its data.

---

## 8. Triggers and the scheduler

- **Manual:** the Run now button.
- **Schedule:** five-field cron in the user's timezone. Every 30 seconds `tick()` selects up to 25 due automations, claims each by moving `next_run_at` forward, skips the slot if an earlier run of the same automation is still active, and starts the run. Runs untouched for 15 minutes are closed as failed.
- **Webhook:** `POST /api/hooks/<token>`. The body becomes the trigger payload. Returns `202` with the run ID, `409` when paused, `429` when rate limited or over the monthly cap. The token can be rotated.

`SCHEDULER=off` stops the in-process scheduler and Telegram polling; an external cron can then call `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET`.

---

## 9. Security

- **Secrets at rest:** API keys and every connection field are encrypted with AES-256-GCM. The key is derived from `APP_SECRET` with HKDF. Changing `APP_SECRET` makes all stored secrets unreadable.
- **Outbound requests:** `safe-fetch.ts` allows only `http` and `https`, refuses URLs with credentials, refuses private, loopback, link-local and carrier-grade NAT ranges as literals, and checks the resolved address again at connection time. Redirects are followed for GET only.
- **Prompt injection:** tool output, webhook payloads and memory are wrapped in tags and the system prompt marks them as data. Write actions need approval by default.
- **Scope limits:** GitHub searches are pinned to the linked repository. HTTP paths that escape the base URL are refused. Discord messages cannot ping roles or `@everyone`.
- **Rate limits:** sign-in, Telegram link creation and webhooks are limited in memory, per process.

---

## 10. What the app needs from the Accred API

| Endpoint | Used for |
| --- | --- |
| `GET /api/customer/models` | Model list for routing and the model picker |
| `POST /api/customer/v1/chat/completions` | Every model call, with an idempotency key of `run-<runId>-<callId>` |
| `GET /api/customer/v1/balance` | Dashboard balance |

Constraints that shape the design:

- **No tool calling.** The API is text only and its OpenAI- and Anthropic-compatible routes reject `tools` with a `400`, hence the JSON protocol.
- **Request size.** The runner keeps the transcript under 27 KB on the assumption of a 32 KB body limit, which is also what the `accred` SDK README states. The `accred-api` source now applies a 4 MB parser to `/api/customer/v1` (`artifacts/api-server/src/app.ts`). Whether that is live in production has not been checked.
- **Each call reserves and settles credit onchain**, so calls are slow. The client timeout is 120 seconds.

---

## 11. Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_SECRET` | yes | 32+ characters; encrypts stored secrets |
| `APP_URL` | production | Public address, used for webhook URLs and the cookie's `secure` flag |
| `CRON_SECRET` | with external cron | Bearer token for `/api/cron/tick` |
| `SCHEDULER` | no | `internal` (default) or `off` |
| `TELEGRAM_BOT_TOKEN` | no | Enables one-click Telegram linking |
| `ACCRED_BASE_URL` | no | Defaults to `https://accred.sh`; point at the mock for local work |
| `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL`, `ROUTER_TOP_MODEL` | no | Pin a tier to one model ID |

---

## 12. Testing

**Covered (19 unit tests in `src/lib/agent/agent.test.ts`):** reply parsing, credit math, model filtering and tier selection, worst-case pricing, blocked addresses, base-URL containment, cron validation and description, HTML and feed extraction, transcript compaction.

**Not covered:**

- the run loop itself (budget stop, downgrade, approval pause and resume, cancel),
- server actions and ownership checks,
- the scheduler's claim logic,
- Telegram linking,
- any tool against a real service,
- the UI.

The mock Accred API makes a full loop test possible without credit; none exists yet.

---

## 13. Known gaps and risks

Found by reading the code. Ordered by how much they matter before launch.

1. **Nothing is committed.** All work sits in the working tree on top of the Create Next App commit, with no remote. One bad command loses it.
2. **An unanswered approval blocks its schedule forever.** The stale-run cleanup covers `queued` and `running` only. A run left in `waiting_approval` never expires, and the scheduler skips every later slot while it exists.
3. **The monthly cap can be passed by parallel runs.** `createRun` reads what is left this month without reserving it. Several webhook runs starting together each get a full per-run budget. Webhook runs are also not limited to one at a time per automation.
4. **A restart loses in-flight runs.** They are marked failed 15 minutes later. They are not resumed, although the transcript is saved after each step.
5. **No migrations.** The schema is applied with `drizzle-kit push`. Production needs generated, reviewed migrations.
6. **The key check depends on API error ordering.** A good key is recognised by a `400` on an empty body. Now that the balance endpoint exists, a `200` from it is a cleaner check.
7. **Rate limits are per process and in memory.** They reset on restart and do not hold across instances.
8. **Only one process may poll the Telegram bot.** A second instance gets `409` and backs off. This is handled, but it ties Telegram linking to a single instance.
9. **Webhooks are authenticated by the URL token only.** There is no signature check for senders such as GitHub or Stripe.
10. **Memory is silently cut.** `memory.save` accepts 4,000 characters and stores 2,000.
11. **No failure notifications.** A failed or budget-stopped scheduled run is visible only in the dashboard.

---

## 14. Milestones

| # | Milestone | Contents | State |
| --- | --- | --- | --- |
| M0 | Local MVP | Everything in section 2 marked Built | Done |
| M1 | Safe to keep | Commit the work, create the remote, generate Drizzle migrations | Next |
| M2 | Launch hardening | Approval timeout (gap 2), monthly cap reservation (gap 3), key check through the balance endpoint (gap 6), loop tests against the mock | |
| M3 | Deploy | Long-running Node host, managed PostgreSQL, `automation` DNS record, secrets, production Telegram bot, smoke test with a real key | |
| M4 | Reach the user | Approve or decline from Telegram, message on failed or budget-stopped runs | |
| M5 | Account sign-in | Shared Privy session with accred.sh in place of a pasted key | |
| M6 | OAuth connections | Gmail, Google Calendar, Notion | |
| M7 | Native tool calling | Replace `protocol.ts` and the parsing in `runner.ts` once the Accred API accepts `tools` | Blocked on the API |

---

## 15. Decisions needed

1. **Hosting.** The app needs a long-running Node process. Which host, and one instance or several? Several instances means moving rate limits out of memory and choosing one instance for the scheduler and Telegram polling.
2. **Approval timeout.** How long may a run wait for approval before it is cancelled: 24 hours, 7 days, or until the next scheduled slot?
3. **Transcript size.** If the 4 MB body limit is live on the API, should the 27 KB cap be raised? A larger transcript means fewer dropped tool results and higher cost per step.
4. **Shared Telegram bot.** Run one official bot for all users, or keep bring-your-own-bot as the only path?
5. **Pricing.** Today the app charges nothing beyond model credits. Does it stay free, or take a fee per run?
6. **Run concurrency for webhooks.** Allow parallel runs of one automation, queue them, or drop events while a run is active?
