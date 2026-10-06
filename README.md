# Accred Automation

The app behind `automation.accred.sh`. A user connects their apps, describes a job in plain words, and an agent runs it on a schedule, on a webhook, or on demand. Every model call is paid from the user's [Accred](https://accred.sh) credits, and each run ends with an exact receipt.

## How it works

1. **Sign in** by pasting an Accred API key. The key is the account: it is checked against the Accred API (without spending credit), stored encrypted, and used to pay for that user's runs.
2. **Connect apps**: Telegram, Slack, Discord, GitHub, or any HTTP API. Reading web pages, JSON APIs and RSS feeds is built in.
3. **Create an automation**: an instruction, a trigger, the connections it may use, a model mode, a credit budget per run and a cap per month.
4. **Runs** are logged step by step with the model used and the exact credits charged.

### Credit balance

The dashboard shows the balance behind the signed-in key. It asks the Accred API at `GET /api/customer/v1/balance` (header `X-Platform-API-Key`, response `{ "availableCreditsExact": "123.45" }`) and refreshes when the stored figure is older than 30 seconds. If the API does not offer that endpoint, the dashboard falls back to the balance returned by the most recent model call and says so.

### Telegram

With `TELEGRAM_BOT_TOKEN` set, users link a chat in one click: the Connections page gives them a one-time `t.me/<bot>?start=<code>` link, they press Start, and the bot ties that chat to their account. The server receives bot messages by long polling (`src/lib/telegram.ts`), so no public webhook is needed and it works on localhost. Only one running process may poll a given bot. Without the token, users paste their own bot token and chat ID instead.

### Gmail

Read-only: the connection asks Google for the `gmail.readonly` scope and gives agents `gmail.search` and `gmail.read`. To enable it, create an OAuth client (type "Web application") in Google Cloud with the Gmail API turned on, add `APP_URL/api/oauth/google/callback` as an authorised redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. While the Google app is in "Testing", only the test users listed on its consent screen can connect, and their access lapses after 7 days. Opening it to everyone requires Google's verification, which for this scope includes a security assessment.

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
| `pnpm test` | Unit tests (protocol, routing, credit math, schedules, outbound request rules) |
| `pnpm db:push` | Apply the schema straight to a development database |
| `pnpm db:generate` | Write a migration file after changing the schema |
| `pnpm db:migrate` | Apply migration files (used in production) |

## Deploying

The scheduler runs inside the server process and runs continue after the request that started them, so deploy this as a **long-running Node server** (`pnpm build && pnpm start`), not as serverless functions.

**Render:** `render.yaml` describes the web service and its Postgres database. Open `https://render.com/deploy?repo=https://github.com/useAccred/accred-automation`, apply the blueprint, then add `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` under Environment. Tables are created by `pnpm db:migrate` on every start. The blueprint uses free plans, and a free web service sleeps when idle: while asleep no schedule fires and the Telegram bot is not heard, so move to a paid instance for real use.

- Set `DATABASE_URL`, `APP_SECRET`, `CRON_SECRET` and `APP_URL=https://automation.accred.sh`.
- Point the `automation` DNS record at the host.
- Run one instance, or set `SCHEDULER=off` on all but one. As an alternative, set it off everywhere and have a cron call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
- Keep `APP_SECRET` safe and unchanged: it encrypts every stored API key and connection secret.

## Layout

```text
src/app/                 pages, server actions, webhook and cron routes
src/components/          shared UI
src/lib/agent/           protocol, model routing, tools, runner, outbound fetch
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
