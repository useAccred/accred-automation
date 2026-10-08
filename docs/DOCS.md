# agent.accred.sh: full documentation

This is the complete documentation for Accred Automation, the app at [agent.accred.sh](https://agent.accred.sh). It covers every part of the platform: signing in, connections, automations, triggers, models, credits, approval, runs, trading agents, security, limits, the HTTP endpoints, and how to host it yourself.

## Contents

1. [What agent.accred.sh is](#1-what-agentaccredsh-is)
2. [Words used in this document](#2-words-used-in-this-document)
3. [Getting started](#3-getting-started)
4. [The app, page by page](#4-the-app-page-by-page)
5. [Automations](#5-automations)
6. [Triggers](#6-triggers)
7. [Connections](#7-connections)
8. [Tools the agent can use](#8-tools-the-agent-can-use)
9. [Models](#9-models)
10. [Credits, budgets and cost](#10-credits-budgets-and-cost)
11. [Approval](#11-approval)
12. [Runs and receipts](#12-runs-and-receipts)
13. [Memory](#13-memory)
14. [Trading agents](#14-trading-agents)
14a. [The Telegram agent](#14a-the-telegram-agent)
15. [Security and privacy](#15-security-and-privacy)
16. [Limits at a glance](#16-limits-at-a-glance)
17. [HTTP endpoints](#17-http-endpoints)
18. [How it works inside](#18-how-it-works-inside)
19. [Hosting it yourself](#19-hosting-it-yourself)
20. [Questions and problems](#20-questions-and-problems)
21. [Not built yet](#21-not-built-yet)
22. [Related documents and contact](#22-related-documents-and-contact)

## 1. What agent.accred.sh is

agent.accred.sh lets you describe a job in plain words and have an AI agent run it for you. You connect the apps the agent may use, choose when the job runs, and set what it may spend. The agent then does the job on a schedule, when a webhook arrives, or when you press a button.

The platform has two products:

- **Automations.** General jobs: read your mail and send a digest, watch a page for changes, triage GitHub issues, explain incoming webhooks, alert you on a price.
- **Trading agents.** An agent that trades on Robinhood Chain inside a risk mandate you set, from a dedicated wallet.

Three things hold for both:

- **One key, one balance.** You sign in with an [Accred](https://accred.sh) API key. Every model call is paid from the credits behind that key. 100 credits = $1. There is no subscription and no extra fee for automation in this version.
- **Any model.** The agent can pick the model for each step, or you can pin any text model in the Accred catalog.
- **You stay in charge.** Every job has a credit budget and a monthly cap. Anything the agent would send or change can wait for your approval. Every run leaves a step-by-step record with the exact credits charged.

## 2. Words used in this document

| Word | Meaning |
| --- | --- |
| Accred API key | The key from accred.sh. It is your account here and it pays for your runs |
| Credits | What model calls cost. 100 credits = $1 |
| Automation | One job: an instruction, a trigger, connections, a model choice and a budget |
| Connection | A link to one of your apps, such as a Telegram chat or a GitHub repository |
| Tool | One thing the agent can do, such as `gmail.search` or `telegram.send_message` |
| Trigger | What starts a run: a schedule, a webhook, or you |
| Run | One execution of an automation |
| Step | One thing that happened in a run: a model decision, a tool call, an approval |
| Receipt | The total credits a run was charged, with the cost of each model call |
| Budget per run | The most one run may spend |
| Cap per month | The most an automation may spend in a calendar month |
| Approval | Your yes or no before the agent sends or changes something |
| Memory | A short note an automation keeps between runs |
| Brain model | The model that decides each step |
| Reading model | A cheaper model that condenses long pages before the brain model sees them |
| Trading agent | An agent that trades for you inside a mandate |
| Mandate | The limits of a trading agent: wallet, allocation, risk rules and allowed assets |

## 3. Getting started

1. **Get a key.** Open the API page at [accred.sh](https://accred.sh) and create an API key. Create a separate key just for automations, so you can revoke it without touching your other apps.
2. **Add credit.** Activate some credit on the Wallet page at accred.sh.
3. **Sign in.** Open [agent.accred.sh](https://agent.accred.sh), press **Sign in** and paste the key. The key is checked with Accred without spending any credit.
4. **Connect an app.** Open **Connections** and add Telegram, Gmail, Slack, Discord, GitHub or an HTTP API. You can skip this: reading web pages and feeds works without any connection.
5. **Create an automation.** Pick a template or press **New automation** and describe your own job.
6. **Try it once.** Open the automation and press **Run now**. Read the run to see each step and what it cost.

## 4. The app, page by page

The top menu has four entries: **Automations**, **Trading**, **Connections** and **Settings**. Your credit balance is shown next to it.

| Page | Address | What it is for |
| --- | --- | --- |
| Home | `/` | What the product does and what it costs |
| Sign in | `/login` | Paste your Accred API key |
| Automations | `/app` | Your automations, your balance, credits used this month, runs waiting for approval, and the templates |
| New automation | `/app/new` | The form to create an automation, empty or from a template |
| An automation | `/app/automations/<id>` | Its settings, next run, memory, webhook URL, run history, and the **Run now**, **Edit**, pause and delete controls |
| A run | `/app/runs/<id>` | Each step of the run, the approval buttons, the result and the receipt |
| Connections | `/app/connections` | Add and remove connections |
| Trading | `/app/trading` | Your trading agents |
| Trading wallets | `/app/trading/wallets` | Create, fund, withdraw from and remove trading wallets |
| Trading guide | `/app/trading/guide` | The user guide for trading agents |
| Settings | `/app/settings` | Replace your API key, sign out, delete your account |
| Privacy and terms | `/privacy`, `/terms` | The privacy policy and the terms of service |

## 5. Automations

### The form

The form has four numbered sections.

**01 · The job**

- **Name.** Up to 80 characters.
- **What should the agent do?** The instruction, from 10 to 4,000 characters. Write it as you would brief a person: where to look, what to decide, where to send the result, and when to do nothing.

Example:

```text
Read https://example.com/feed.xml, pick the three most important posts
and send me a short summary on Telegram. If there is nothing new, send nothing.
```

**02 · Trigger**

When the automation runs. See [Triggers](#6-triggers).

**03 · Connections**

Select the connections this automation may use. A connection you have added is not used until it is selected here. You can select at most one connection of each type per automation. The form then lists what the agent can do with this setup.

**04 · Brain and budget**

- **Model choice.** See [Models](#9-models).
- **Budget per run** and **Cap per month**, in credits. See [Credits, budgets and cost](#10-credits-budgets-and-cost).
- **Ask me before it sends or changes anything.** On by default. See [Approval](#11-approval).

### Templates

Each template fills in the instruction, the trigger and the connections it needs. You can change every word before anything runs.

| Template | What it does | Trigger | Needs |
| --- | --- | --- | --- |
| Inbox digest to Telegram | Reads your unread email and sends you the ones that matter, one line each | Every day at 08:00 | Gmail, Telegram |
| Morning news briefing | Reads a feed and sends five bullet points | Every day at 08:00 | Telegram |
| Price alert | Checks a price and messages you only when it crosses your line | Every hour | Telegram |
| Watch a page for changes | Remembers what a page said last time and tells you what changed | Every 6 hours | Slack |
| Triage new GitHub issues | Labels unlabelled issues and asks for what is missing | Every hour | GitHub |
| Weekly shipping digest | Summarizes the pull requests merged this week | Mondays at 09:00 | GitHub, Discord |
| Explain incoming webhooks | Turns raw webhook payloads into a readable Slack message | When a webhook arrives | Slack |

### Managing an automation

On the automation's page you can:

- **Run now**: start a run at once.
- **Edit**: change any setting.
- **Pause** it, and **Turn on** again later: a paused automation does not run on its schedule, and its webhook answers `409`.
- **Clear** its memory.
- **Replace this URL**: give a webhook automation a new private URL. The old one stops working.
- **Delete automation**: removes the automation and its run history. This cannot be undone.

### Writing a good instruction

- Say exactly where to look: a URL, a Gmail search, a GitHub query.
- Say what to send and where: "send one Telegram message", "post to Slack".
- Say when to do nothing: "if nothing changed, do nothing".
- Use memory for anything the next run must know: "save the newest entry in memory".
- Keep it to one job. The agent may make at most 10 tool calls in a run.

## 6. Triggers

| Trigger | How a run starts |
| --- | --- |
| On a schedule | By itself at the times you set |
| When a webhook arrives | Another service calls a private URL |
| Only when I press Run | You press **Run now**. Good for trying a job out first |

### Schedule

Choose **Every 15 minutes**, **Every hour**, **Every 6 hours**, **Every day**, **Every week**, or **Custom (cron)**.

- A custom schedule is a five-field cron expression: minute, hour, day, month, weekday. For example `0 9 * * 1` is Mondays at 09:00.
- Times are in your timezone.
- Runs must be at least 5 minutes apart.
- If an earlier run of the same automation is still going or is waiting for your approval, that time slot is skipped.
- The scheduler checks for due automations about every 30 seconds.

### Webhook

After you save a webhook automation, its page shows a private URL. Send a `POST` request to it to start a run. The body is handed to the agent as the trigger payload.

```bash
curl -X POST 'https://agent.accred.sh/api/hooks/<token>' \
  -H 'content-type: application/json' \
  -d '{"event":"test","message":"Hello from curl"}'
```

- The answer is `202` with `{"runId": "...", "status": "queued"}`.
- A body of up to 64 KB is accepted. The first 6 KB are given to the agent.
- The limit is 30 requests per minute per webhook.
- Anyone with the URL can start runs, so treat it like a password. Use **Replace this URL** if it leaks.

See [HTTP endpoints](#17-http-endpoints) for every status code.

## 7. Connections

A connection is one place the agent can act. Secrets are encrypted when stored and are never shown again. An automation uses only the connections you select for it.

| Connection | How you connect it | What the agent can do |
| --- | --- | --- |
| Telegram | Press Start in the Accred bot, or link your own bot | Send a message to your chat |
| Gmail | Sign in with Google | Search your mail and read an email. Read-only |
| Slack | Paste an incoming webhook URL | Post a message to one channel |
| Discord | Paste a webhook URL | Post a message to one channel |
| GitHub | Paste a personal access token and a repository name | Search issues and pull requests, read an issue, comment, add labels, open an issue |
| HTTP API | Enter a base URL and an optional auth header | Call any JSON API under that URL |

Google Calendar and Notion are listed as coming soon.

### Telegram

You link a chat by pressing Start in a bot, so you never have to look up a chat ID.

- **Use the Accred bot.** The page gives you a link. Open it in Telegram and press **Start**. The page updates by itself. The link works once and expires in 15 minutes.
- **Use my own bot.** In Telegram, open @BotFather, send `/newbot`, and paste the token it gives you. Then open your bot and press **Start**. The token is stored encrypted and used only to send your messages. A bot that is already used by another app cannot be linked: create a separate bot for this.

Messages are plain text, up to 4,000 characters.

### Gmail

Press **Connect** and sign in with Google. Keep the permission to read mail ticked on Google's screen, or the connection is not made.

- The app asks for read-only access (`gmail.readonly`). The agent cannot send, delete or change email.
- Your mail is read only while one of your automations runs, and only to carry out its instruction.
- Emails the agent reads are sent to the AI model that runs the job.
- You can remove the connection at any time, here or at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### Slack

Create an incoming webhook for the channel in your Slack app settings and paste its URL (`https://hooks.slack.com/services/…`). The agent can post to that one channel.

### Discord

In the channel settings, open **Integrations → Webhooks → New webhook** and paste its URL. The agent can post to that one channel, up to 2,000 characters per message. Messages written by the agent never ping `@everyone` or roles.

### GitHub

Paste a fine-grained personal access token limited to the repositories you want automated, with Issues read and write, and the repository as `owner/name`. The agent can act only on that one repository.

### HTTP API

Enter a base URL that starts with `https://`, and optionally the name and value of an auth header. The agent can call only paths under that URL. `GET` requests read; `POST`, `PUT`, `PATCH` and `DELETE` requests change data and need approval when approval is on.

## 8. Tools the agent can use

Two tools are always available. The rest come with the connections you select.

| Tool | Needs | Effect | What it does |
| --- | --- | --- | --- |
| `web.fetch` | Nothing | Read | Fetches a public web page, JSON API or RSS feed and returns its text |
| `memory.save` | Nothing | Internal | Replaces the automation's saved note |
| `telegram.send_message` | Telegram | **Write** | Sends a plain-text message to your chat |
| `slack.post_message` | Slack | **Write** | Posts a message to your channel |
| `discord.post_message` | Discord | **Write** | Posts a message to your channel |
| `gmail.search` | Gmail | Read | Searches your mail with Gmail search syntax. Returns sender, subject, date and a preview for up to 15 emails |
| `gmail.read` | Gmail | Read | Reads the full text of one email found by `gmail.search` |
| `github.search` | GitHub | Read | Searches issues and pull requests in the linked repository. Returns up to 20 |
| `github.get_issue` | GitHub | Read | Reads one issue or pull request with its latest 10 comments |
| `github.comment` | GitHub | **Write** | Adds a comment to an issue or pull request |
| `github.add_labels` | GitHub | **Write** | Adds up to 10 labels |
| `github.create_issue` | GitHub | **Write** | Opens a new issue |
| `http.request` | HTTP API | Read for `GET`, **Write** otherwise | Calls your API on a path under its base URL |

**Write** tools change something outside the app. When approval is on, each one waits for your yes.

Notes on `web.fetch`:

- It reads public addresses only. Private, loopback and link-local addresses are refused.
- HTML pages are turned into text and feeds into a list of entries.
- When a site answers "too many requests", it tries once more after a short pause. A second refusal means the site is limiting this server, and the agent is told to stop and report it.

Long results are condensed. When a tool returns more than about 5 KB, the reading model shortens it to what matters for the job before the brain model sees it.

## 9. Models

| Mode | Brain model | Reading model | Use it for |
| --- | --- | --- | --- |
| Auto | A strong model | A fast, cheap model | Most jobs. The default |
| Economy | A fast, cheap model | The same model | Simple jobs that run often |
| Best quality | A top model | A strong model | Hard jobs. Costs several times more per run |
| Choose models | The model you pick | The model you pick, or the brain model | When you want one specific model |

- The form shows which models each mode means right now, under **Right now this means**.
- With **Choose models** you can search the whole Accred catalog. Each model is shown with its price in US dollars per million tokens. Stronger models follow instructions more reliably; smaller ones can stumble on the action format.
- The catalog changes. Auto, Economy and Best quality resolve against the live catalog each run, so they keep working when a model is retired.
- If a pinned brain model leaves the catalog, runs fail with a message until you pick another. If a pinned reading model leaves it, the brain model reads instead.

## 10. Credits, budgets and cost

**Price.** 100 credits = $1. You pay the model cost of each run from your Accred credits, at the price in the Accred catalog. Automation itself has no extra fee in this version.

**Balance.** The dashboard shows the balance behind your key, live from Accred, and the credits your automations used this month. Press **Add credit** to top up at accred.sh.

**Budget per run.** The most one run may spend, from 0.1 to 1,000 credits. A new automation starts at 10.

**Cap per month.** The most an automation may spend in a calendar month. It cannot be lower than the budget per run. A new automation starts at 300. Once the cap is reached, no more runs start that month.

**How the budget is enforced.**

- Before every model call, the app prices the worst case: the whole input plus the largest answer allowed. If that could pass the run's budget, the call is not made.
- When the strong model no longer fits but the cheap one does, the run switches to the cheap one first.
- When nothing fits, the run stops with the status **Stopped at budget**.
- A run's budget is the lower of the budget per run and what is left of the monthly cap.

The limits cap what an automation can spend. They do not guarantee that a job finishes within them. Credits spent on a run are not refunded because the result was not what you wanted.

## 11. Approval

With **Ask me before it sends or changes anything** on:

1. Reading never needs approval.
2. When the agent wants to use a write tool, the run pauses with the status **Needs approval**.
3. The dashboard shows that a run is waiting. Open it to see the exact message or change.
4. Press **Approve** to let it happen, or **Decline**. Nothing is sent until you approve. If you decline, the agent is told and wraps up.

A scheduled automation does not start another run while one is waiting for approval.

Turn approval off once you trust the job. The automation's page then says **Acts without asking**.

## 12. Runs and receipts

Open a run to see what happened.

**Statuses**

| Status | Meaning |
| --- | --- |
| Queued | Created, about to start |
| Running | The agent is working |
| Needs approval | Paused until you approve or decline a write |
| Succeeded | The agent finished the job and wrote a result |
| Failed | The run could not finish. The reason is shown |
| Stopped at budget | The credit budget or the monthly cap was reached |
| Cancelled | You pressed **Stop run** |

**Steps.** Each step shows what the agent decided or did, the model that handled it, the tokens in and out, and the credits charged.

**Receipt.** The total credits charged, the share of the run budget used, and the number of model calls.

**Trigger payload.** For a webhook run, the body that started it.

**Rules a run follows**

- At most 10 tool calls and 16 model calls.
- One tool call at a time.
- A reply from the model that is not in the expected format is asked for again. Three such replies end the run as failed.
- A run that stops reporting for 15 minutes, for example because the server restarted, is closed as failed with the note "The run was interrupted. Nothing further was charged."

## 13. Memory

Each automation keeps one short note between runs. The agent writes it with `memory.save` and sees it at the start of every later run.

- Saving replaces the note. It holds up to 2,000 characters.
- Use it for state: the last price alerted on, the newest entry already reported, the issues already triaged.
- The automation's page shows the note. Press **Clear** to empty it.

## 14. Trading agents

A trading agent is an AI model that trades for you inside limits you set. You do not give it your wallet. You give it a **mandate**: a dedicated wallet, a maximum amount it may use, risk rules and a list of tokens.

Agents trade **with real funds on Robinhood Chain mainnet** (chain ID 4663). They buy tokens with USDG, the chain's dollar stablecoin, and sell them back to USDG. There is no practice mode.

> **This is real money.** An agent can lose money. The limits cap the loss; they do not prevent it. Start small.

### What you need

- An Accred API key with credits.
- A trading wallet used only for this agent. Create it under **Trading → Wallets**.
- USDG in that wallet to buy positions with, and a little ETH for network fees, both sent on Robinhood Chain.

### Setting one up

1. **Create a wallet and fund it.** Under **Trading → Wallets**, press **Create wallet**, copy the deposit address, and send USDG and a little ETH to it on Robinhood Chain. Funds sent on another network cannot be recovered.
2. **Create the agent.** Press **New trading agent** and fill in the nine sections:

   | Section | What you set |
   | --- | --- |
   | 01 · Agent and model | A name and the AI model: Auto, Economy, Best quality or a model you choose |
   | 02 · Dedicated wallet | The wallet the agent trades from |
   | 03 · Agent allocation | The most the agent may deploy. A hard cap, at least $10. Profits are not added to it |
   | 04 · Strategy | Momentum, Breakout, Trend following, Mean reversion, Volume expansion, your own words, and how often it looks at the market |
   | 05 · Risk mandate | A profile (Conservative, Balanced, Aggressive or Custom) and every limit: capital, loss, position, execution, frequency |
   | 06 · Assets | The tokens the agent may trade. Nothing is allowed by default |
   | 07 · Mode | Live on Robinhood Chain mainnet |
   | 08 · Notifications and credits | Where notices go, the credit budget per cycle and the cap per month |
   | 09 · Review permissions and limits | What the agent is allowed to do |

3. **Review and approve.** Read the summary, tick both approval boxes, and press **Approve and start trading**.

### What happens in a cycle

1. The app reads prices for your selected tokens.
2. It applies your market filters and strategy screens. If no token passes, the model is not called and no credits are spent.
3. If a token passes, the model is asked once. It may propose up to three trades.
4. Each proposal goes through **17 risk checks**. If one fails, the proposal is rejected. The model cannot override a rejection.
5. A proposal that passes is simulated on the chain from your wallet. If the simulation passes, the swap is signed and sent.
6. The position is then watched about every 20 seconds, without the model. It is sold at its stop loss, its take profit, its trailing stop or its time limit.

### What keeps it safe

- **The model only proposes.** It never sees a key, an address to send to, or transaction data.
- **Seventeen deterministic checks** approve every trade: trading enabled, allocation and real wallet balance, position size, total exposure, open positions, trade frequency, daily loss, drawdown, losses in a row, asset allowlist, liquidity and market data, stop loss, risk/reward, slippage and price impact, on-chain simulation, network fee, and a fresh quote.
- **Simulation before signing.** Every swap is run on the chain from the wallet before anything is signed. Approvals are for the exact amount of each trade, never unlimited.
- **The signer has no destination.** The trading code can sign only an approval or a swap through one pinned router. It cannot send funds to any other address.
- **Automatic pauses.** New trading pauses on the daily loss limit, the drawdown limit, losses in a row, missing or stale prices, repeated failures, a trade that slipped far more than allowed, or a wallet that holds less than its positions record. A pause never stops protective exits. Resuming is always done by you.
- **Profit and loss from receipts.** Every figure comes from transactions on the chain, not from quotes.

### Controls

| Control | What it does |
| --- | --- |
| Pause agent | No new positions. Stops, targets and time limits keep running |
| Close all positions | Pauses the agent, then sells every open position back to USDG |
| Revoke trading access | Removes the agent's permission to propose or open trades. Starting again needs a fresh approval |
| Revoke trading authority | On the wallet. No agent using that wallet can open a position until it is restored |
| Withdraw funds | Only you can move ETH or USDG out. The agent never can |

### What it costs

- **Model credits** for each cycle that calls the model. A cycle that does not call the model costs 0 credits.
- **Network fees** in ETH for each transaction. A buy is two transactions: an approval, then the swap. A trade that fails on the chain still pays its fee.
- **Pool and router fees**, which are inside the price you get.

The agent page shows the **Net result** after all of these.

### Full trading documents

- [TRADING_USER_GUIDE.md](TRADING_USER_GUIDE.md): the complete manual, with every field, the agent page, withdrawing, and common problems. Also in the app at `/app/trading/guide`.
- [TRADING_AGENT.md](TRADING_AGENT.md): the architecture, the security checklist, and what has and has not been verified.

## 14a. The Telegram agent

The whole platform in one Telegram chat. Open **@AccredAgentbot**, paste your API key once, and talk to it in plain words. The bot runs as its own service, [accred-telegram-agent](https://github.com/useAccred/accred-telegram-agent), on this app's engine and database. It answers with any model, runs jobs, controls and creates trading agents, and keeps working while you are away.

### Getting started

1. Open @AccredAgentbot in Telegram and press **Start**.
2. Paste your Accred API key. The message is deleted as soon as the bot reads it, and the key is stored encrypted. A chat you linked earlier with **Connect** on the Connections page is linked already.
3. Ask anything, or say what you want done.

The chat is your web account: everything created from the chat appears at agent.accred.sh, and the other way round.

### What you can say

- **Questions.** "Explain x402 in two lines." "Which model is cheapest for summaries?"
- **Jobs.** "Every morning at 8, send me the three most important AI headlines." "Check this page and tell me when the price drops below 50." These become automations with this chat as their Telegram connection.
- **Trading.** "How are my agents doing?" "Pause Momentum A." "Close everything." "Create a wallet." "Set up a balanced agent with $200 on the two most liquid tokens."
- **Preferences.** "Keep answers short." "I am in Berlin." The agent saves them and uses them next time.

### Buttons before anything happens

Anything that sends, creates, runs, pauses or trades is shown first with **Confirm** and **Cancel** buttons. The model only proposes; the tap runs it. Creating a trading agent shows the full mandate in sentences and the button reads **Approve and start trading**. A request expires after 10 minutes.

When an automation on the web stops at **Needs approval**, the bot sends the pending action with **Approve** and **Decline** buttons, so you never have to open the site.

### What it does on its own

- **Daily brief** at the hour you choose (`/brief 8`): balance, yesterday's spend, every trading agent's state and result, automation runs, anything auto-paused.
- **Low-balance warning** once a day when your credits fall under your threshold (200 by default).
- **Trade notices**: executions, rejections, exits, pauses and failures from agents created in the chat, through the normal notification path.

None of this calls a model, so it costs nothing.

### Costs and limits

Each reply is paid from your credits with the exact amount recorded. Defaults: 3 credits per message and 50 per day, changeable with `/budget`. The model is Auto unless you pick another with `/model`. A reply that would pass a limit is not sent; the bot says which limit and how to change it.

### Commands

| Command | Does |
| --- | --- |
| `/status` | Balance, agents, pending confirmations, settings |
| `/brief 8` · `/brief off` | Daily brief at 08:00 in your timezone, or none |
| `/timezone Asia/Kolkata` | Your timezone |
| `/budget 5 100` | Credits per message and per day |
| `/model auto` · `economy` · `quality` · `<model id>` | Which model answers |
| `/memory` · `/forget` | What the agent remembers about you, or clear it |
| `/new` | Start a fresh conversation |
| `/key` | Replace your API key |
| `/stop` | Unlink this chat. Your account and its data stay |

### What it never does

- Withdraw or transfer funds. Withdrawals stay on the web.
- Show, send or accept a private key or seed phrase.
- Raise an allocation, loosen a mandate or grant a permission. Edits stay on the web form with its risk-increase confirmation.
- Decide a trade. The risk engine decides every trade inside the mandate; the chat model only reports.
- Work in group chats.

The plan and design are in the bot's repository: [docs/PLAN.md](https://github.com/useAccred/accred-telegram-agent/blob/main/docs/PLAN.md).

## 15. Security and privacy

### How your secrets are kept

- **Encrypted at rest.** Your Accred API key and every connection secret are encrypted with AES-256-GCM before they are stored. They are never sent back to the browser and never shown again.
- **What is kept of your key.** The encrypted key, a one-way hash used to sign you in, and its last four characters so you can recognise it.
- **Wallet keys are separate.** Trading-wallet keys are encrypted under their own key, apart from everything else, so the Accred API key cannot sign a trade.
- **Sessions.** One cookie keeps you signed in for 30 days. It cannot be read by scripts on the page, and only its hash is stored. There are no advertising or analytics cookies.
- **HTTPS.** The app is served over HTTPS.

### How the agent is contained

- **Least access.** An automation uses only the connections selected for it. A GitHub connection is limited to one repository. An HTTP connection is limited to paths under one base URL.
- **Outside content is data.** What the agent reads from a web page, an email, a webhook payload or its own memory is marked as data, and the agent is told never to follow instructions found there. No safeguard is complete, so keep approval on for jobs that read untrusted content and can write.
- **No private network access.** Requests the agent makes cannot reach private, loopback or link-local addresses. This is checked again when the connection is made.
- **Rate limits.** Sign-in attempts and webhook calls are limited.

### What is stored

| Data | What is kept |
| --- | --- |
| Account | Your encrypted key, its hash and its last four characters |
| Automations | The instruction, trigger, model choice, budgets and memory |
| Connections | What is needed to act in each app. Secrets are encrypted |
| Run history | The steps, the model for each step, the credits charged, the result, and a short excerpt of what each tool returned |
| Webhook payloads | Stored with the run they started |

Excerpts in the run history can contain content from your connected apps, such as the sender and subject of an email.

### Where your data goes

- **AI model providers, through Accred.** The instruction and whatever the agent reads during a run are sent to the model that handles each step.
- **The apps you connect.** What your automation sends goes to the app you chose.
- **Infrastructure providers.** The app and its database run on hosting services.

Your data is not sold or shared for advertising. Google data is not used for advertising or to train general AI models.

### Removing your data

- Deleting an automation removes its run history.
- Removing a connection removes its stored secret.
- **Settings → Delete account** removes your automations, trading agents, run history, connections and stored key. Trading wallets must be emptied first, because deleting the account destroys their keys. Your Accred account and credits are not affected.

### If your key leaks

Revoke it at accred.sh. If you still use this app, create a new key and replace it under **Settings** first: your automations stop when the stored key is revoked.

## 16. Limits at a glance

| Limit | Value |
| --- | --- |
| Automation name | 80 characters |
| Instruction | 10 to 4,000 characters |
| Connections per automation | One of each type |
| Shortest gap between scheduled runs | 5 minutes |
| Budget per run | 0.1 to 1,000 credits |
| Cap per month | At least the budget per run |
| Tool calls per run | 10 |
| Model calls per run | 16 |
| Memory | 2,000 characters |
| Webhook payload accepted | 64 KB |
| Webhook payload given to the agent | 6 KB |
| Webhook calls | 30 per minute per webhook |
| Sign-in attempts | 8 per minute |
| Telegram message | 4,000 characters |
| Discord message | 2,000 characters |
| Slack message | 8,000 characters |
| Gmail search results | 15 per search |
| Email text read | 16,000 characters |
| GitHub search results | 20 per search |
| Page size for `web.fetch` | 1.5 MB |
| Telegram link | Works once, expires in 15 minutes |
| Sign-in session | 30 days |
| Trading: smallest allocation | $10 |
| Trading: credit budget per cycle | 0.1 to 100 credits |
| Trading: proposals per cycle | 3 |
| Telegram agent: credits per message | 0.1 to 100 (default 3) |
| Telegram agent: credits per day | 1 to 5,000 (default 50) |
| Telegram agent: tool calls per message | 6 |
| Telegram agent: messages per minute | 20 |
| Telegram agent: confirmation expires after | 10 minutes |

## 17. HTTP endpoints

### `POST /api/hooks/<token>`

Starts a run of the webhook automation that owns the token. The body becomes the trigger payload. No other authentication: the token is the secret.

| Status | Meaning |
| --- | --- |
| `202` | The run was queued. Body: `{"runId": "...", "status": "queued"}` |
| `404` | No webhook automation has this token |
| `409` | The automation is paused |
| `413` | The payload is larger than 64 KB |
| `429` | More than 30 requests in a minute, or the automation has reached its monthly credit cap |

### `GET /api/health`

Answers `{"ok": true}`. For the host's health check.

### `GET` or `POST /api/cron/tick`

Starts every scheduled automation and trading cycle that is due, and runs the position monitor. For hosts where the built-in scheduler is turned off. Requires `Authorization: Bearer <CRON_SECRET>`; anything else answers `401`. Call it every minute.

### `GET /api/oauth/google/start` and `/api/oauth/google/callback`

The Google sign-in flow for the Gmail connection. The callback address must be registered as a redirect URI in Google Cloud.

## 18. How it works inside

### The agent loop

The Accred API is text in, text out, with no native tool calling. So the agent speaks a small JSON protocol. Each reply from the model is one JSON object that either calls a tool or finishes:

```json
{"thought": "I need the feed first.", "tool": "web.fetch", "args": {"url": "https://example.com/feed.xml"}}
```

```json
{"thought": "The summary is sent.", "final": "Sent three headlines to Telegram."}
```

The runner checks the reply, runs the tool, and hands the result back to the model, until the job is done or a limit is reached. The transcript is kept under the API's 32 KB request limit by dropping the oldest tool results.

### Where things live

```text
src/app/                 pages, server actions, webhook, OAuth and cron routes
src/components/          shared UI
src/lib/agent/           protocol, model routing, tools, runner, outbound fetch
src/lib/trading/         trading agents: mandate, risk engine, live execution, position monitor, wallets
src/lib/connections/     connection types and their fields
src/lib/db/              database schema and client
src/lib/templates.ts     starter automations
drizzle/                 database migrations
scripts/mock-accred.mjs  local stand-in for the Accred API
```

| File | What it does |
| --- | --- |
| `src/lib/agent/protocol.ts` | The system prompt and the reply format |
| `src/lib/agent/runner.ts` | Runs an automation: budget, limits, approval, steps |
| `src/lib/agent/router.ts` | Picks the brain and reading models for each mode |
| `src/lib/agent/tools.ts` | Every tool and the connection test |
| `src/lib/agent/safe-fetch.ts` | Outbound requests that cannot reach private addresses |
| `src/lib/scheduler.ts` | Starts scheduled automations that are due |
| `src/lib/crypto.ts` | Encryption of keys, secrets and wallet keys |
| `src/lib/auth.ts` | Sessions and rate limits |
| `src/lib/telegram.ts` | Linking Telegram chats and receiving bot updates |
| `src/lib/connections/gmail.ts` | Google sign-in and reading mail |

### Data

The database is PostgreSQL. The main tables are `users`, `sessions`, `connections`, `automations`, `runs` and `run_steps`, plus the trading tables: `trading_wallets`, `trading_automations`, `risk_mandates`, `trading_strategies`, `trading_runs`, `trade_proposals`, `risk_evaluations`, `positions`, `executions` and `audit_events`, and the Telegram agent's `bot_chats`, `bot_turns` and `bot_actions`.

Built with Next.js 16, React 19, Tailwind CSS 4, Drizzle ORM, viem and the [`accred`](https://www.npmjs.com/package/accred) SDK.

## 19. Hosting it yourself

### Run it locally

Requires Node 20 or newer, pnpm and PostgreSQL.

```bash
pnpm install
cp .env.example .env.local      # then fill in APP_SECRET and CRON_SECRET
createdb accred_automation
set -a; . ./.env.local; set +a  # pnpm db:push reads DATABASE_URL from your shell
pnpm db:push
pnpm dev
```

To develop without spending credit, run a scripted stand-in for the Accred API:

```bash
pnpm mock:accred
ACCRED_BASE_URL=http://localhost:4010 pnpm dev
```

Sign in with the key the mock prints.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_SECRET` | Yes | 32 or more random characters. Encrypts stored keys and connection secrets. Changing it makes every stored secret unreadable |
| `CRON_SECRET` | With an external cron | Bearer token for `/api/cron/tick` |
| `APP_URL` | For local development | The public address. In production the app uses the domain each request arrives on |
| `SCHEDULER` | No | `internal` (default) runs the scheduler inside the server. `off` leaves it to an external cron |
| `TELEGRAM_BOT_TOKEN` | No | The shared Telegram bot. Without it, users link their own bot |
| `TELEGRAM_POLLING` | With the Telegram agent | `off` when accred-telegram-agent polls the same bot; this app then only sends |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | The Google OAuth client for Gmail |
| `ACCRED_BASE_URL` | No | The Accred API address. Default `https://accred.sh` |
| `ROUTER_SMART_MODEL`, `ROUTER_FAST_MODEL`, `ROUTER_TOP_MODEL` | No | Override the model behind each tier |
| `LIVE_TRADING` | No | `on` lets agents trade with real funds. Anything else: no trade can be signed |
| `TRADING_WALLET_SECRET` | With trading | 32 or more random characters. Encrypts wallet keys. Set it before the first wallet is created and never change it |
| `ROBINHOOD_RPC_URL` | No | An HTTPS RPC endpoint tried before the public ones. Must support `eth_simulateV1` |
| `LIFI_API_KEY` | No | Raises the request limit on swap routes |
| `COINGECKO_PRO_API_KEY` or `COINGECKO_DEMO_API_KEY` | No | Market data with your own request limit. The free providers often refuse shared hosts |

### Setting up Gmail on your server

Create an OAuth client of type "Web application" in Google Cloud with the Gmail API turned on. Add `<your address>/api/oauth/google/callback` as an authorised redirect URI. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

While the Google app is in "Testing", only the test users listed on its consent screen can connect, and their access lapses after 7 days. Opening it to everyone requires Google's verification.

### Deploying

Deploy it as a **long-running Node server** (`pnpm build && pnpm start`), not as serverless functions: the scheduler runs inside the server, and runs continue after the request that started them.

- `render.yaml` describes the service for Render. Tables are created by `pnpm db:migrate` on every start.
- Use an always-on instance. A server that sleeps fires no schedule and does not hear the Telegram bot.
- Run one instance, or set `SCHEDULER=off` on all but one. Only one process may listen to a given Telegram bot.
- Keep `APP_SECRET` and `TRADING_WALLET_SECRET` safe and unchanged.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm db:push` | Apply the schema to a development database |
| `pnpm db:generate` | Write a migration file after changing the schema |
| `pnpm db:migrate` | Apply migration files |
| `pnpm mock:accred` | A local stand-in for the Accred API |

## 20. Questions and problems

**"Accred did not accept that key."**
The key is wrong or was revoked. Create a new one at accred.sh and paste it again.

**My automation did not run at its time.**
Check that it is not paused, that its monthly cap is not reached, and that no earlier run is still going or waiting for your approval.

**The run says "Stopped at the credit budget".**
The job needed more than the budget per run. Raise the budget or use Economy mode.

**The run says the agent used all of its steps.**
The job needs more than 10 tool calls. Make the instruction narrower, or split it into two automations.

**The agent says it has no tool for Telegram, Gmail or another app.**
The connection is added but not selected for this automation. Edit the automation and select it under **03 · Connections**.

**"Gmail is not set up on this server yet."**
The server has no Google OAuth client. See [Setting up Gmail on your server](#setting-up-gmail-on-your-server).

**Google says the app has not completed verification.**
The Google app is in "Testing". Only the test users listed on its consent screen can connect.

**My Telegram bot cannot be linked.**
The bot is already used by another app, so its messages cannot be read here. Create a separate bot with @BotFather.

**A site keeps answering "too many requests".**
That site limits how often this server may read it. Run the job less often or use another source.

**My webhook answers `429`.**
Either more than 30 calls arrived in a minute, or the automation has reached its monthly cap. The answer says which.

**My balance is not shown.**
It appears after your first run, or as soon as Accred reports it.

**I cannot delete my account.**
A trading wallet still holds funds, or its balance could not be checked. Withdraw everything first.

For trading agents, see [Questions and problems](TRADING_USER_GUIDE.md#14-questions-and-problems) in the trading user guide.

## 21. Not built yet

- Sign in with the Accred account itself instead of a pasted key.
- More connections: Google Calendar and Notion.
- Native tool calling, once the Accred API supports it.
- Approving a paused run from Telegram or email instead of the web page.

## 22. Related documents and contact

| Document | What it covers |
| --- | --- |
| [TRADING_USER_GUIDE.md](TRADING_USER_GUIDE.md) | The complete user manual for trading agents |
| [TRADING_AGENT.md](TRADING_AGENT.md) | Trading architecture, the risk checks, the security checklist and open risks |
| [PLAN_AUTOMATION.md](PLAN_AUTOMATION.md) | The original plan for automations |
| [PLAN_TRADING_AGENT.md](PLAN_TRADING_AGENT.md) | The original plan for trading agents |
| [accred-telegram-agent](https://github.com/useAccred/accred-telegram-agent) | The Telegram agent: its own service, design in its docs/PLAN.md |
| [../README.md](../README.md) | The short overview of the repository |

Questions: [contact@accred.sh](mailto:contact@accred.sh). The privacy policy is at [agent.accred.sh/privacy](https://agent.accred.sh/privacy) and the terms are at [agent.accred.sh/terms](https://agent.accred.sh/terms).
