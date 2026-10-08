# Accred Automation

**Live at [agent.accred.sh](https://agent.accred.sh)**

Connect your apps, describe a job in plain words, and an AI agent runs it for you: on a schedule, when a webhook arrives, or on demand. Every model call is paid from your [Accred](https://accred.sh) credits, and every run ends with a step-by-step log and the exact credits it cost.

- **One key, one balance.** Sign in with an Accred API key. 100 credits = $1, pay per run, no subscription.
- **You choose the model, or the agent does.** Auto mode uses a strong model to decide and a cheap one to read.
- **You stay in charge.** A credit budget per run, a cap per month, and approval before anything is sent or changed.
- **Trading agents.** Give an agent a risk mandate on Robinhood Chain instead of access to your wallet.
- **A Telegram agent.** Paste your API key in the Accred bot and do all of the above by chatting: ask anything, create jobs, control trading agents, get a daily brief. Every action waits for a button tap.

## Contents

- [What you can do with it](#what-you-can-do-with-it)
- [How it works](#how-it-works)
- [Connections and tools](#connections-and-tools)
- [Triggers](#triggers)
- [Models, budget and approval](#models-budget-and-approval)
- [Trading agents](#trading-agents)
- [The Telegram agent](#the-telegram-agent)
- [Security](#security)
- [The agent loop](#the-agent-loop)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Commands](#commands)
- [Deploying](#deploying)
- [Project layout](#project-layout)
- [Documentation](#documentation)
- [Not built yet](#not-built-yet)

## What you can do with it

Each of these ships as a template you can edit:

| Template | What it does | Trigger |
| --- | --- | --- |
| Inbox digest to Telegram | Reads your unread email and sends the ones that matter, one line each | Every day at 08:00 |
| Morning news briefing | Reads the feeds you care about and sends five bullet points | Every day at 08:00 |
| Price alert | Checks a price and messages you only when it crosses your line | Every hour |
| Watch a page for changes | Remembers what a page said last time and tells you what changed | Every 6 hours |
| Triage new GitHub issues | Labels unlabelled issues and asks for what is missing | Every hour |
| Weekly shipping digest | Summarizes the pull requests merged this week | Mondays at 09:00 |
| Explain incoming webhooks | Turns raw webhook payloads into a readable Slack message | When a webhook arrives |

## How it works

1. **Sign in** by pasting an Accred API key. The key is the account: it is checked against the Accred API without spending credit, stored encrypted, and used to pay for that user's runs.
2. **Connect apps.** Each automation can use only the connections you give it.
3. **Create an automation**: an instruction in plain words, a trigger, the connections it may use, a model mode, a credit budget per run and a cap per month.
4. **Read the receipt.** Every run is logged step by step with the model used and the exact credits charged for each model call.

The dashboard shows the credit balance behind the signed-in key. It asks the Accred API at `GET /api/customer/v1/balance` and refreshes when the stored figure is older than 30 seconds. If the API does not offer that endpoint, it falls back to the balance returned by the most recent model call and says so.

## Connections and tools

| Connection | How you connect it | What the agent can do |
| --- | --- | --- |
| Telegram | Press Start in the shared bot, or paste your own bot's token | Send a message |
| Gmail | Sign in with Google (`gmail.readonly` scope) | Search your mail, read an email. It cannot send, delete or change anything |
| Slack | Incoming webhook URL | Post a message to one channel |
| Discord | Webhook URL | Post a message to one channel |
| GitHub | Fine-grained personal access token and one repository | Search issues and pull requests, read an issue, comment, add labels, open an issue |
| HTTP API | A base URL and an optional auth header | Call any JSON API under that URL |

Two tools need no connection: `web.fetch` reads public web pages, JSON APIs and RSS feeds, and `memory.save` keeps a short note that later runs of the same automation can read.

The full tool list, with the tools that change something marked **write**:

| Tool | Effect |
| --- | --- |
| `web.fetch` | read |
| `memory.save` | internal |
| `gmail.search`, `gmail.read` | read |
| `github.search`, `github.get_issue` | read |
| `github.comment`, `github.add_labels`, `github.create_issue` | **write** |
| `telegram.send_message` | **write** |
| `slack.post_message` | **write** |
| `discord.post_message` | **write** |
| `http.request` | read for `GET`, **write** for every other method |

### Telegram

Users link a chat by pressing Start in a bot, so nobody has to look up a chat ID. Two bots work this way:

- **The shared bot.** With `TELEGRAM_BOT_TOKEN` set, the Connections page gives a one-time `t.me/<bot>?start=<code>` link. The server hears the Start message by long polling (`src/lib/telegram.ts`), so no public webhook is needed and it works on localhost. Only one running process may poll a given bot.
- **A user's own bot.** The user pastes the token from @BotFather. It is checked, stored encrypted with their connection, and used only to send that user's messages. Nothing listens to their bot permanently: while they are on the page, the server looks in the bot's updates for their Start message. A bot that already has a webhook or another listener cannot be linked.

### Gmail

Read-only. To enable it, create an OAuth client of type "Web application" in Google Cloud with the Gmail API turned on, add `<your address>/api/oauth/google/callback` as an authorised redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

While the Google app is in "Testing", only the test users listed on its consent screen can connect, and their access lapses after 7 days. Opening it to everyone requires Google's verification, which for this scope includes a security assessment.

## Triggers

| Trigger | How it starts a run |
| --- | --- |
| Schedule | A five-field cron expression in the automation's timezone. Runs must be at least 5 minutes apart |
| Webhook | A `POST` to the automation's private URL. The request body becomes the trigger payload |
| Manual | The **Run now** button |

A webhook-triggered automation has its own URL, shown on its page:

```bash
curl -X POST https://agent.accred.sh/api/hooks/<token> \
  -H "content-type: application/json" \
  -d '{"event": "deploy.failed", "service": "api"}'
```

It answers `202` with `{"runId": "...", "status": "queued"}`. The limits are 64 KB per payload and 30 requests per minute per webhook. A paused automation answers `409`, and one that has reached its monthly credit cap answers `429`.

## Models, budget and approval

**Model modes**

| Mode | What it does |
| --- | --- |
| Auto | A strong model decides each step. A fast, cheap one condenses long pages |
| Economy | A fast, cheap model does everything. Best for simple jobs that run often |
| Best quality | A top model decides each step. Costs several times more per run |
| Choose models | You pick the model that decides, and optionally a cheaper one for reading |

Tiers resolve against the live Accred model catalog, with a price-based fallback when a preferred model is gone.

**Budget.** Every automation has a credit budget per run and a cap per month. Before each model call the agent prices the worst case, and it stops instead of spending past the budget. Once an automation reaches its monthly cap, new runs are refused until the cap is raised or the month ends.

**Approval.** Reading never needs approval. Tools that send or change something pause the run and show you the exact message or change, until you approve or reject it. This is on by default and can be turned off per automation.

**Cost.** You pay the model cost of each run from your Accred credits. Automation itself has no extra fee in this version.

## Trading agents

Under **Trading**, a user gives an agent a mandate on Robinhood Chain instead of access to a wallet: a dedicated wallet, a capped allocation, a risk mandate and a list of assets.

- The model **proposes** trades and nothing else. It never sees a key, a destination address or calldata.
- A **deterministic risk engine** with seventeen checks approves or rejects each proposal.
- Every swap is validated, **simulated on the chain** from the wallet, and only then signed. Approvals are for the exact amount of each trade.
- A **model-free monitor** enforces stops, targets, trailing stops, time limits and circuit breakers about every 20 seconds.
- Profit and loss are computed from **transaction receipts**, not quotes.

Agents trade **with real funds on Robinhood Chain mainnet** (chain ID 4663), buying and selling against USDG. There is no simulated mode. Trading is off unless `LIVE_TRADING=on` is set on the server.

> **This is real money.** An agent can lose money. The limits cap the loss; they do not prevent it. Read [what has and has not been verified](docs/TRADING_AGENT.md#what-has-and-has-not-been-verified) before funding a wallet, and start small.

| Document | For |
| --- | --- |
| [docs/TRADING_USER_GUIDE.md](docs/TRADING_USER_GUIDE.md) | Users. Also shown in the app at `/app/trading/guide` |
| [docs/TRADING_AGENT.md](docs/TRADING_AGENT.md) | Developers and auditors: architecture, the seventeen checks, the security checklist, open risks |
| [docs/PLAN_TRADING_AGENT.md](docs/PLAN_TRADING_AGENT.md) | The original plan |

## The Telegram agent

Open the shared Accred bot in Telegram, paste your Accred API key once (the message is deleted as soon as it is read), and talk to it:

- "What happened in AI today?" answers with the model you chose, paid from your credits with the exact cost recorded.
- "Every morning at 8, send me the three most important crypto headlines." creates an automation with this chat as its Telegram connection.
- "How are my agents doing?", "Pause Momentum A", "Close everything", "Set up a balanced agent with $200" read and control trading agents through the same code as the dashboard.

Anything that sends, creates, pauses or trades is shown first with Confirm and Cancel buttons; creating a trading agent shows the full mandate and the button reads "Approve and start trading". Runs that stop at "Needs approval" on the web arrive in the chat with Approve and Decline buttons. On its own, the bot sends a daily brief at the hour you pick and a low-balance warning. It never withdraws funds, never touches keys, and never loosens a mandate; those stay on the web. Commands: `/status`, `/brief 8`, `/budget 5 100`, `/model`, `/memory`, `/new`, `/key`, `/stop`. Design and details: [docs/PLAN_TELEGRAM_AGENT.md](docs/PLAN_TELEGRAM_AGENT.md).

## Security

- **Secrets are encrypted at rest.** Accred API keys and connection secrets are stored with AES-256-GCM under a key derived from `APP_SECRET`. Secret fields are never sent back to the browser.
- **Wallet keys use a separate key.** Trading-wallet private keys are encrypted under their own key (`TRADING_WALLET_SECRET`), so nothing that can read stored API keys can read a signing key, and the other way round.
- **Sessions.** The session cookie is `httpOnly`, lasts 30 days, and only its SHA-256 hash is stored. Sign-in attempts are rate-limited.
- **Least access.** An automation sees only the connections assigned to it. A GitHub connection is limited to one repository, and an HTTP connection to paths under one base URL.
- **Untrusted content.** Tool output and webhook payloads are wrapped and marked as data, not instructions.
- **Outbound requests.** `safe-fetch.ts` refuses private, loopback and link-local addresses, and checks again at connection time.
- **The code is public.** Everything that touches a key or a secret is in this repository.

## The agent loop

The Accred API is text in, text out, with no native tool calling. So the agent speaks a small JSON protocol (`src/lib/agent/protocol.ts`): each model reply is one object that either calls a tool or finishes. The runner (`src/lib/agent/runner.ts`) validates the reply, runs the tool, and feeds the result back, until the job is done or a limit is reached.

- **Model choice** (`router.ts`): Auto uses a strong model to decide each step and a cheap one to condense long tool output. Economy and Best quality shift both tiers. `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL` and `ROUTER_TOP_MODEL` override the tiers.
- **Budget**: before every model call the runner prices the worst case (input plus the full output allowance) and stops if that could pass the run's budget. When the strong model no longer fits but the cheap one does, it switches down first.
- **Limits**: 10 tool calls and 16 model calls per run. The transcript is kept under the API's 32 KB request limit by dropping the oldest tool results.
- **Memory**: each automation keeps one short note, written with `memory.save` and shown to later runs.

## Run it locally

Requires Node 20 or newer, pnpm, and PostgreSQL.

```bash
pnpm install
cp .env.example .env.local      # then fill in APP_SECRET and CRON_SECRET
createdb accred_automation
pnpm db:push                    # creates the tables (reads DATABASE_URL from your shell)
pnpm dev
```

`pnpm db:push` does not read `.env.local`. Export `DATABASE_URL` first, for example with `set -a; . ./.env.local; set +a`.

### Develop without spending credit

```bash
pnpm mock:accred                                   # a scripted stand-in for the Accred API on :4010
ACCRED_BASE_URL=http://localhost:4010 pnpm dev
```

Sign in with the key the mock prints. Its "model" follows a fixed script: read a feed, save a note, use a write tool if one is linked, finish.

## Configuration

All settings are environment variables. `.env.example` lists them with comments.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `APP_SECRET` | Yes | 32+ random characters. Encrypts stored API keys and connection secrets. Changing it makes every stored secret unreadable |
| `CRON_SECRET` | With an external cron | Bearer token for `/api/cron/tick` |
| `APP_URL` | Local development | Public address of the app. In production the app uses the domain each request arrives on, so set it only to force one address |
| `SCHEDULER` | No | `internal` (default) runs the scheduler inside the server. `off` leaves it to an external cron |
| `TELEGRAM_BOT_TOKEN` | No | The shared Telegram bot. Without it, users link their own bot |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | OAuth client for the Gmail connection |
| `ACCRED_BASE_URL` | No | Accred API address. Default `https://accred.sh` |
| `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL`, `ROUTER_TOP_MODEL` | No | Override the model behind each tier |

Trading agents:

| Variable | Purpose |
| --- | --- |
| `LIVE_TRADING` | Set to `on` to let agents trade. Anything else: no trade can be signed and no agent can be started |
| `TRADING_WALLET_SECRET` | 32+ random characters. Encrypts wallet keys. Set it before the first wallet is created and never change it. Without it, a key derived from `APP_SECRET` is used |
| `ROBINHOOD_RPC_URL` | An HTTPS RPC endpoint tried before the rate-limited public ones. Must support `eth_simulateV1` |
| `LIFI_API_KEY` | Raises the request limit on swap routes from LI.FI |
| `COINGECKO_PRO_API_KEY` or `COINGECKO_DEMO_API_KEY` | Market data whose request limit belongs to your key. The free providers often answer HTTP 429 to shared hosts such as Render |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests: protocol, routing, credit math, schedules, outbound request rules, trading risk engine. Set `TRADING_TEST_DATABASE_URL` to also run the trading tests that need Postgres |
| `pnpm db:push` | Apply the schema straight to a development database |
| `pnpm db:generate` | Write a migration file after changing the schema |
| `pnpm db:migrate` | Apply migration files (used in production) |
| `pnpm mock:accred` | A local stand-in for the Accred API |

## Deploying

The scheduler runs inside the server process, and runs continue after the request that started them. Deploy this as a **long-running Node server** (`pnpm build && pnpm start`), not as serverless functions.

**Render.** `render.yaml` describes the web service. Create it from the blueprint or with the Render CLI, set `DATABASE_URL` to a Postgres connection string, then add `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` under Environment. Tables are created by `pnpm db:migrate` on every start. Use an always-on paid instance: a free web service sleeps when idle, and while it sleeps no schedule fires and the Telegram bot is not heard.

On any host:

- Set `DATABASE_URL`, `APP_SECRET` and `CRON_SECRET`.
- Point your domain's DNS record at the host. Production runs at `agent.accred.sh`.
- Run one instance, or set `SCHEDULER=off` on all but one. As an alternative, set it off everywhere and have a cron call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
- Keep `APP_SECRET` and `TRADING_WALLET_SECRET` safe and unchanged: they encrypt every stored key and secret.
- `GET /api/health` answers `{"ok": true}` for the host's health check.

## Project layout

```text
src/app/                 pages, server actions, webhook, OAuth and cron routes
src/components/          shared UI
src/lib/agent/           protocol, model routing, tools, runner, outbound fetch
src/lib/trading/         trading agents: mandate, risk engine, live execution, position monitor, wallets
src/lib/connections/     connection types and their fields
src/lib/db/              Drizzle schema and client
src/lib/templates.ts     starter automations
drizzle/                 database migrations
docs/                    plans, trading architecture and the user guide
scripts/mock-accred.mjs  local stand-in for the Accred API
```

Built with Next.js 16, React 19, Tailwind CSS 4, Drizzle ORM on PostgreSQL, viem and the [`accred`](https://www.npmjs.com/package/accred) SDK.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/DOCS.md](docs/DOCS.md) | The full documentation of the platform: every page, connection, tool, limit and endpoint |
| [docs/TRADING_USER_GUIDE.md](docs/TRADING_USER_GUIDE.md) | How to create, fund, run and stop a trading agent |
| [docs/TRADING_AGENT.md](docs/TRADING_AGENT.md) | Trading architecture, risk checks, security checklist and open risks |
| [docs/PLAN_AUTOMATION.md](docs/PLAN_AUTOMATION.md) | The original plan for automations |
| [docs/PLAN_TRADING_AGENT.md](docs/PLAN_TRADING_AGENT.md) | The original plan for trading agents |

## Not built yet

- Sign in with the Accred account itself (a shared Privy session) instead of a pasted key.
- More connections: Google Calendar and Notion.
- Native tool calling, once the Accred API supports it. The JSON protocol is isolated in `protocol.ts` and `runner.ts` to keep that swap small.
- Approving a paused run from Telegram or email instead of the web page.
