# Accred Automation

The app behind `agent.accred.sh`. A user connects their apps, describes a job in plain words, and an agent runs it on a schedule, on a webhook, or on demand. Every model call is paid from the user's [Accred](https://accred.sh) credits, and each run ends with an exact receipt.

## How it works

1. **Sign in** by pasting an Accred API key. The key is the account: it is checked against the Accred API (without spending credit), stored encrypted, and used to pay for that user's runs.
2. **Connect apps**: Telegram, Slack, Discord, GitHub, or any HTTP API. Reading web pages, JSON APIs and RSS feeds is built in.
3. **Create an automation**: an instruction, a trigger, the connections it may use, a model mode, a credit budget per run and a cap per month.
4. **Runs** are logged step by step with the model used and the exact credits charged.

### Credit balance

The dashboard shows the balance behind the signed-in key. It asks the Accred API at `GET /api/customer/v1/balance` (header `X-Platform-API-Key`, response `{ "availableCreditsExact": "123.45" }`) and refreshes when the stored figure is older than 30 seconds. If the API does not offer that endpoint, the dashboard falls back to the balance returned by the most recent model call and says so.

### Telegram

Users link a chat by pressing Start in a bot, so nobody looks up a chat ID. Two bots work this way:

- **The shared bot.** With `TELEGRAM_BOT_TOKEN` set, the Connections page gives a one-time `t.me/<bot>?start=<code>` link. The server hears the Start message by long polling (`src/lib/telegram.ts`), so no public webhook is needed and it works on localhost. Only one running process may poll a given bot.
- **A user's own bot.** The user pastes the token from @BotFather. It is checked, stored encrypted in the database with their connection, and used only to send that user's messages. Nothing listens to their bot permanently: while they are on the page the server looks in the bot's updates for their Start message. A bot that already has a webhook or another listener cannot be linked.

### Gmail

Read-only: the connection asks Google for the `gmail.readonly` scope and gives agents `gmail.search` and `gmail.read`. To enable it, create an OAuth client (type "Web application") in Google Cloud with the Gmail API turned on, add `APP_URL/api/oauth/google/callback` as an authorised redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. While the Google app is in "Testing", only the test users listed on its consent screen can connect, and their access lapses after 7 days. Opening it to everyone requires Google's verification, which for this scope includes a security assessment.

### Trading agents

Under **Trading**, a user gives an agent a mandate on Robinhood Chain instead of access to a wallet: a dedicated wallet, a capped allocation, a risk mandate and a list of assets. The model proposes trades; a deterministic risk engine with seventeen checks approves or rejects each one, and a model-free monitor enforces stops, targets and circuit breakers.

Agents trade **with real funds on Robinhood Chain mainnet** (chain ID 4663), buying and selling against USDG. Every swap is validated, simulated on the chain from the wallet, and only then signed; profit and loss are computed from transaction receipts. Trading is off unless `LIVE_TRADING=on` is set. [docs/TRADING_AGENT.md](docs/TRADING_AGENT.md) has the architecture, the security checklist and what must still be verified with real funds.

### The agent loop

The Accred API is text in, text out, with no native tool calling. So the agent speaks a small JSON protocol (`src/lib/agent/protocol.ts`): each model reply is one object that either calls a tool or finishes. The runner (`src/lib/agent/runner.ts`) validates the reply, runs the tool, and feeds the result back, until the job is done or a limit is reached.

- **Model choice** (`router.ts`): *Auto* uses a strong model to decide each step and a cheap one to condense long tool output. *Economy* and *Best quality* shift both tiers. *One model* pins a catalog model. Tiers resolve against the live catalog, with a price-based fallback when the preferred ids are gone. `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL` and `ROUTER_TOP_MODEL` override them.
- **Budget**: before every model call the runner prices the worst case (input plus the full output allowance) and stops if that could pass the run's budget. When the strong model no longer fits but the cheap one does, it switches down first.
- **Approval**: tools that send or change something pause the run until the user approves, unless the automation turns that off.
- **Limits**: 10 tool calls and 16 model calls per run. The transcript is kept under the API's 32 KB request limit by dropping the oldest tool results.
- **Untrusted content**: tool output and webhook payloads are wrapped and marked as data. Outbound requests (`safe-fetch.ts`) refuse private, loopback and link-local addresses, checked again at connection time.

## Run it locally

Requires Node 20 or newer, pnpm, and PostgreSQL.

```bash
pnpm install
cp .env.example .env.local      # then fill in APP_SECRET and CRON_SECRET
createdb accred_automation
pnpm db:push                    # creates the tables (reads DATABASE_URL from your shell)
pnpm dev
```

`pnpm db:push` does not read `.env.local`; export `DATABASE_URL` first, for example `set -a; . ./.env.local; set +a`.

### Develop without spending credit

```bash
pnpm mock:accred                                   # a scripted stand-in for the Accred API on :4010
ACCRED_BASE_URL=http://localhost:4010 pnpm dev
```

Sign in with the key the mock prints. Its "model" follows a fixed script: read a feed, save a note, use a write tool if one is linked, finish.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests (protocol, routing, credit math, schedules, outbound request rules, trading risk engine). Set `TRADING_TEST_DATABASE_URL` to also run the trading tests that need Postgres |
| `pnpm db:push` | Apply the schema straight to a development database |
| `pnpm db:generate` | Write a migration file after changing the schema |
| `pnpm db:migrate` | Apply migration files (used in production) |

## Deploying

The scheduler runs inside the server process and runs continue after the request that started them, so deploy this as a **long-running Node server** (`pnpm build && pnpm start`), not as serverless functions.

**Render:** `render.yaml` describes the web service. Create it from the blueprint or with the Render CLI, set `DATABASE_URL` to a Postgres connection string, then add `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` under Environment. Tables are created by `pnpm db:migrate` on every start. Use an always-on paid instance: a free web service sleeps when idle, and while asleep no schedule fires and the Telegram bot is not heard.

- Set `DATABASE_URL`, `APP_SECRET` and `CRON_SECRET`. `APP_URL` is optional: without it the app uses the domain each request arrives on, so it works on every domain attached to it. Set it only to force one address.
- Point the `automation` DNS record at the host.
- Run one instance, or set `SCHEDULER=off` on all but one. As an alternative, set it off everywhere and have a cron call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
- Keep `APP_SECRET` safe and unchanged: it encrypts every stored API key and connection secret.

## Layout

```text
src/app/                 pages, server actions, webhook and cron routes
src/components/          shared UI
src/lib/agent/           protocol, model routing, tools, runner, outbound fetch
src/lib/trading/         trading agents: mandate, risk engine, live execution, position monitor, wallets
src/lib/db/              Drizzle schema and client
src/lib/connections/     connection types and their fields
src/lib/templates.ts     starter automations
scripts/mock-accred.mjs  local stand-in for the Accred API
```

## Not built yet

- Sign in with the Accred account itself (shared Privy session) instead of a pasted key.
- OAuth connections: Gmail, Google Calendar, Notion.
- Native tool calling, once the Accred API supports it. The JSON protocol is isolated in `protocol.ts` and `runner.ts` to make that swap small.
- Approving a paused run from Telegram or email instead of the web page.
