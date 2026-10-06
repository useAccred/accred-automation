# Trading agents: user guide

This guide shows you how to set up a trading agent, how to read what it does, and how to stop it. It is written for users of the app. You do not need to know how to code.

## Contents

1. [What a trading agent is](#1-what-a-trading-agent-is)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Step 1: create a wallet and fund it](#3-step-1-create-a-wallet-and-fund-it)
4. [Step 2: create your agent](#4-step-2-create-your-agent)
5. [Step 3: review and approve](#5-step-3-review-and-approve)
6. [What happens after you start](#6-what-happens-after-you-start)
7. [Reading the agent page](#7-reading-the-agent-page)
8. [Emergency controls](#8-emergency-controls)
9. [Pausing, resuming and editing](#9-pausing-resuming-and-editing)
10. [Withdrawing funds](#10-withdrawing-funds)
11. [Notifications](#11-notifications)
12. [What it costs](#12-what-it-costs)
13. [Safety tips and risks](#13-safety-tips-and-risks)
14. [Questions and problems](#14-questions-and-problems)

## 1. What a trading agent is

A trading agent is an AI model that trades for you inside limits that you set. You do not give it your wallet. You give it a **mandate**: a separate wallet, a maximum amount it may use, strict risk rules, and a list of tokens it may trade. The model studies the market and proposes trades. The app checks every proposal against your rules before anything moves. A proposal that breaks a rule is rejected, whatever the model says.

Agents trade with **real funds on Robinhood Chain mainnet**. They buy tokens with **USDG**, the dollar stablecoin of the chain, and sell them back to USDG. There is no practice mode.

## 2. What you need before you start

- **An Accred API key with credits.** You sign in with it. Each time the agent asks the model, the cost is paid from your credits. 100 credits = $1.
- **A trading wallet.** A wallet used only for this agent. You create it in the app in Step 1. Never use your main wallet.
- **USDG in that wallet.** The agent buys positions with USDG.
- **A little ETH in that wallet.** Every transaction on the chain needs a small network fee, paid in ETH.

## 3. Step 1: create a wallet and fund it

1. Open **Trading** in the top menu, then press **Wallets**.
2. Under **Create a wallet**, type a name if you want one, and press **Create wallet**. This is the recommended way: a fresh wallet that has never been used for anything else.
3. Your new wallet appears in the list with its address.
4. Under **Deposit**, copy the **Deposit address**.
5. From your own wallet or exchange, send **USDG** and a little **ETH** to that address **on Robinhood Chain (chain ID 4663)**.
6. Wait for the transfer to arrive. The page shows **Wallet balance**, **ETH** and **USDG** live from the chain.

Important:

- Funds sent on another network cannot be recovered. Check the network before you send.
- The key of a wallet you create is made on the server and stored encrypted. It is never shown, never given to a model and never written to a log.

**Already have a wallet made for this purpose?** Use **Import a wallet** instead. Paste its **Private key**, tick the box that says the wallet was made only for this agent, and press **Import wallet**. Do not import a wallet that holds anything else.

## 4. Step 2: create your agent

Open **Trading** and press **New trading agent**. The form has nine numbered sections. Fill them in from top to bottom.

### 01 · Agent and model

- **Name.** Any name that helps you recognise the agent.
- **AI model.** You can let Accred pick for you, or choose the model yourself.
  - **Auto**: a strong model studies the market each cycle.
  - **Economy**: a fast, cheap model. Lowest cost per cycle.
  - **Best quality**: a top model. Costs several times more per cycle.
  - **Or choose the model yourself**: press one of the top models, such as Claude, GPT, Gemini, Grok, DeepSeek, Kimi or Qwen. Each one is shown with its logo, its maker and its price.
  - **Any other model**: type a name in the search box to pick any model in the Accred catalog.

Auto, Economy and Best quality each show the model they use right now. Prices are US dollars per 1 million tokens, paid from your Accred credits. A model marked **Premium** costs the most for each cycle, and one marked **Low cost** the least.

The model only proposes trades. It holds no keys and cannot move funds.

### 02 · Dedicated wallet

Choose the wallet the agent will trade from. The wallet needs USDG to buy positions with and a little ETH for network fees before the agent can trade. If you have no wallet yet, go back to Step 1.

### 03 · Agent allocation

In **The most the agent may deploy ($)**, type the largest amount the agent may use. The minimum is $10.

- This is a hard cap. Profits are not added to it, and it is never raised without your approval.
- The rest of the wallet is shown as **Outside the agent's reach**.
- A trade larger than the USDG the wallet really holds is refused.

Example: the wallet holds $5,000 and the allocation is $1,000. The agent can never use the other $4,000.

### 04 · Strategy

Under **What the agent looks for**, pick one or more strategies:

- **Momentum**: price rising over the last hour and the last six.
- **Breakout**: a sharp move in the last hour on real volume.
- **Trend following**: up over a day and still up over six hours.
- **Mean reversion**: a sharp dip in an asset that is not in free fall.
- **Volume expansion**: trading volume well above its recent average.

Each strategy is a fixed screen that runs first. The model is only called, and credits only spent, when a token passes one.

- **In your own words (optional).** Describe what you want in plain language. This guides what the model proposes. It can never override your limits.
- **How often it looks at the market.** From **Every 5 minutes** to **Once a day**. Stops and targets are checked about every 20 seconds, whatever you choose here.

You must pick at least one strategy, or describe one in your own words.

### 05 · Risk mandate

These are hard limits enforced by the app, not suggestions to the model.

Start with a profile. A profile only fills in the fields below it. There are no hidden rules.

- **Conservative**: small positions, tight stops, deep liquidity only.
- **Balanced**: moderate positions with a 2% stop and a 5% target.
- **Aggressive**: larger positions, wider stops, thinner markets allowed.
- **Custom**: selected as soon as you edit any limit.

Then check each group and change what you want:

- **Capital.** How much the agent may deploy, in total and per position. For example **Largest position**, **Total open exposure**, **Open positions at once** and **Untouchable reserve**.
- **Loss.** When the agent must stop. For example **Largest loss per trade**, **Daily loss limit**, **Maximum drawdown**, **Losses in a row** and **Cooldown after a loss**. Reaching any of these pauses new trading automatically.
- **Position.** How each position is protected. For example **Default stop loss**, **Widest stop loss**, **Default take profit**, **Minimum risk/reward**, **Trailing stop**, **Break-even trigger**, **Partial profit at** and **Longest time in a position**.
- **Execution.** What a trade must look like at the moment it is made. For example **Slippage allowed**, **Price impact allowed**, **Minimum liquidity**, **Minimum market cap**, **Minimum token age** and **Network fee allowed**.
- **Frequency.** How often the agent may trade: **Trades per hour**, **Trades per day** and **Cooldown between trades**.

Two switches:

- **Every proposal must state its stop loss.** When on, a proposal without a stop loss is rejected. When off, the default stop loss is applied instead. Either way, no position is ever open without a stop.
- **Only open positions during set hours.** Choose the hours and days. Exits are enforced at all hours.

Each field has a short explanation under it. Read them before you change a number.

### 06 · Assets

The agent may only trade what you select here. Nothing is allowed by default.

- Press a token in the list of the most traded tokens on Robinhood Chain to add it.
- Or paste a token address under **Add a token by address** and press **Add**.
- **Blocklist (optional)**: token addresses the agent must never trade, one per line.

You must select at least one asset.

### 07 · Mode

There is one mode: **Live on Robinhood Chain mainnet**, with real funds. Every trade is a real swap from the agent's wallet. Each one is simulated on the chain first and only signed if that passes.

### 08 · Notifications and credits

- **Send notices to.** Pick the connections that should receive messages about this agent. See [Notifications](#11-notifications).
- **Credit budget per cycle.** The most one cycle may spend on the model, from 0.1 to 100 credits. The model is not called if the call could cost more.
- **Credit cap per month.** The agent stops asking the model once this is reached. Open positions stay protected.

### 09 · Review permissions and limits

This section lists what the agent is allowed to do: **Read market data**, **Read balances**, **Propose trades**, **Open positions**, **Close positions**, **Manage protective exits** and **Send notifications**. The ones marked **Sensitive** can move funds inside your limits. An agent that may open positions must also be able to protect and close them, so those boxes stay ticked.

Below the list, **With this mandate the agent:** sums up your limits in plain sentences.

## 5. Step 3: review and approve

1. Read the summary under **With this mandate the agent:**. Check the amounts and the token list.
2. Tick **I have reviewed these permissions and limits and approve them**.
3. Tick **I understand this agent trades real funds from its wallet**. Losses are real and trades on the chain cannot be undone. The limits cap what the agent can lose. They do not prevent loss.
4. Press **Approve and start trading**.

The agent starts trading as soon as you approve. You can pause it at any time.

## 6. What happens after you start

The agent works in **cycles**. The first cycle starts within a minute. After that, a cycle runs as often as you chose in section 04.

In each cycle:

1. The app reads prices for your selected tokens.
2. It applies your market filters and your strategy screens. If no token passes, the model is not called and no credits are spent.
3. If a token passes, the model is asked once. It may propose up to three trades.
4. Each proposal goes through **17 risk checks**. If one check fails, the proposal is rejected. The model cannot override a rejection.
5. A proposal that passes is simulated on the chain from your wallet. If the simulation passes, the swap is signed and sent.
6. The position is then watched about every 20 seconds, without the model. It is sold when it reaches its stop loss, its take profit, its trailing stop or its time limit.

Common reasons a proposal is rejected:

- The position is larger than your limits allow.
- The token has too little liquidity, or is not on your list.
- The stop loss is missing or too wide, or the risk/reward is too low.
- The wallet does not hold enough USDG, or enough ETH for the network fee.
- A daily loss limit, a drawdown limit or a cooldown is active.
- The trade would move the price too much, or the simulation failed.

A rejection is the system working as planned. It costs nothing on the chain.

## 7. Reading the agent page

Open **Trading** and press your agent. At the top you see its state: **Live · mainnet**, and **Running**, **Paused**, **Auto-paused** or **Stopped**.

- **The numbers at the top.** **Agent allocation**, **Available capital**, **Open exposure**, **Drawdown**, **Realized PnL** (sold positions, less every fee paid), **Unrealized PnL** (open positions at the last price), **Today** and **Total PnL**.
- **Open positions.** What the agent holds now, with the **Stop loss** and **Take profit** price of each. Press **Close** on a position to sell it at the market price.
- **Decisions.** Every proposal the model made, including the ones that were rejected. Each one shows **Confidence**, **Requested position**, **Stop loss**, **Take profit**, **Maximum planned loss** and **Risk checks** (for example 17/17 passed). Open a check to see why it passed or failed.
- **Trades.** Every swap the agent made or attempted, with a link to the transaction. PnL is computed from these.
- **Cycles.** One line per cycle: what happened, which model was used, the tokens in and out, and the credits charged. **No model call** means the cycle cost 0 credits.
- **Activity.** The latest events. Press **Full audit log** to see everything the agent did, and why. Entries are only ever added. Keys and secrets are never recorded.
- **Closed positions.** Past positions and their result.
- **Net result after costs.** **Gross trading PnL**, less **Swap fees**, **Network fees** and **LLM cost**, gives the **Net result**. You also see **LLM credits charged** and how many cycles made a model call.
- **Results so far.** **Closed trades**, **Win rate**, **Average win**, **Average loss**, **Max drawdown**, **Average slippage**, and **Why proposals were rejected**.
- **Your limits.** The mandate now in force. Open **All limits** to see every one.

Two buttons at the top: **Edit mandate** changes the agent's settings. **Run a cycle now** starts a cycle without waiting.

## 8. Emergency controls

These are always on the agent page.

- **Pause agent.** Stops new positions at once. Stop loss, take profit and time limits keep running on what is open.
- **Close all positions.** Pauses the agent, then sells every open position at the current market price. A position that cannot be priced, or whose sale fails, stays open under its stop loss, and you are told.
- **Revoke trading access.** Removes the agent's permission to propose or open trades. Open positions stay protected. Starting again needs a fresh approval.
- **Withdraw funds.** Opens the wallet with the withdrawal form ready. Only you can move funds out. The agent never can.

There is one more control on the **Wallets** page: **Revoke trading authority**. It stops every agent that uses that wallet from opening positions, at once. Protective exits on open positions continue. You can restore it later with **Restore trading authority**.

## 9. Pausing, resuming and editing

**Pause and resume.** Press **Pause agent** to stop new positions. Press **Resume agent** to start again.

**Automatic pauses.** The agent pauses itself when a safety limit is reached. The page then shows **Auto-paused** and the reason. This happens on:

- the daily loss limit, the drawdown limit, or too many losses in a row;
- prices that are missing or out of date, or a market data provider that keeps failing;
- simulations or sales that keep failing;
- a trade that slipped far more than your limit;
- a wallet that holds less than the agent's positions say it should;
- any state the app cannot read.

A pause never stops protective exits. Resuming is always done by you. After an automatic pause, resuming restarts the loss streak and the drawdown measure from the current value of the agent.

**Editing.** Press **Edit mandate**, change what you want, tick the approval boxes and press **Approve and save changes**.

- Saving creates a new version of the mandate. Every trade records the version that approved it.
- If a change lets the agent risk more, the app lists it under **These changes let the agent risk more than before**. You must tick **I understand and approve these increases** to save.
- Open positions keep the exit rules of the version that approved them. Changes apply to new trades.
- While positions are open, you cannot remove the permissions that protect them. Close the positions first.

**After you revoked access.** Press **Review and re-approve**, check the permissions and approve them again. This grants access again and restarts the agent.

**Deleting.** **Delete agent** is at the bottom of the agent page. Close all open positions first.

## 10. Withdrawing funds

1. Open **Trading**, then **Wallets**. Or press **Withdraw funds** on the agent page.
2. Open **Withdraw funds** on the wallet.
3. Choose the **Asset**: **USDG** or **ETH**.
4. Type the **Amount**, or press **Max**.
5. In **Send to**, paste the address on Robinhood Chain that should receive the funds.
6. Tick the box to confirm that you checked the address.
7. Press **Withdraw**.

Good to know:

- A transfer on Robinhood Chain cannot be undone. Check the address twice.
- The transfer is simulated first and only signed if that passes.
- The network fee is paid in ETH, so withdraw ETH last.
- Tokens held in open positions are not USDG yet. Use **Close all positions** first to sell them back to USDG.
- **Remove wallet** is only possible when the wallet holds no ETH or USDG and no agent uses it. Other tokens are not checked: anything left in the wallet is lost with its key.

## 11. Notifications

The agent can send you a message when something happens.

1. Open **Connections** in the top menu and add Telegram, Slack or Discord.
2. In the agent form, section 08, pick the connection under **Send notices to**.

You are told about executions, rejections, stop loss and take profit, loss limits, automatic pauses, failures and manual stops.

A connection can only carry messages out. It never grants trading authority.

## 12. What it costs

- **Model credits.** Each cycle that calls the model is paid from your Accred credits. 100 credits = $1. A cycle that does not call the model costs 0 credits. Your **Credit budget per cycle** and **Credit cap per month** limit this.
- **Network fees (gas).** Each transaction on the chain is paid in ETH from the trading wallet. A buy is two transactions: an approval, then the swap. A trade that fails on the chain still pays its gas.
- **Pool and router fees.** These are inside the price you get when you buy and sell. They show up in your trading PnL, not as a separate line.

The agent page shows the **Net result** after all of these.

## 13. Safety tips and risks

- **This is real money.** The agent can lose money. The limits cap the loss. They do not prevent it.
- **Start small.** Begin with a small allocation and a small largest position. Watch a few trades before you raise anything.
- **Use a dedicated wallet.** Keep only what you are prepared to allocate in it.
- **Be careful with thin tokens.** A token with little liquidity costs more to buy and to sell. The price you get can be several percent worse than the market price.
- **A stop loss can sell by itself.** When the price falls to the stop, the position is sold without asking you. In a fast market the sale price can be lower than the stop price.
- **Some tokens cannot be sold.** A token that blocks transfers or taxes sales can fail its exit. You choose the list of tokens, so choose tokens you know.
- **Trades cannot be undone.** A swap or a transfer on the chain is final.
- **Keep a little ETH in the wallet.** Without ETH for the network fee, the agent cannot buy, and it cannot sell.
- **Check the agent regularly.** Turn on notifications so you know when it trades or pauses.

## 14. Questions and problems

**The cycle says "The model was not called".**
No token passed your market filters and strategy screens, or a limit already blocked new positions. Nothing was spent. This is normal.

**My agent shows "Auto-paused".**
A safety limit was reached. The reason is shown at the top of the agent page. Open positions are still protected. Read the reason, fix the cause if there is one, then press **Resume agent**.

**A trade failed because there was not enough ETH.**
The wallet could not pay the network fee. Send a little more ETH to the wallet on Robinhood Chain and wait for the next cycle.

**The page says "Live trading is switched off on this server".**
Trading is turned off for the whole site, so an agent cannot be started or changed yet. Your funds are not affected. Try again later.

**Every proposal is rejected.**
Open the proposal under **Decisions** and look at the failed check. Often the largest position is too small for the model's request, the token has less liquidity than your minimum, or the wallet holds too little USDG.

**A trade shows "Sent, waiting for the chain to confirm".**
The swap was sent and the app is waiting for the chain. Its amount stays reserved, so it cannot be spent twice. The app settles it by itself.

**I cannot press "Approve and start trading".**
The button is greyed out when you have no trading wallet, or when live trading is off for the site. If you can press it but the form is not saved, tick both approval boxes and select at least one asset.

**The page says trading authority is revoked for the wallet.**
Open **Wallets** and press **Restore trading authority** on that wallet.

**My agent says it was created in Paper Mode.**
Paper Mode has been retired. That agent no longer runs. Create a new agent to trade.

**I want everything out now.**
Press **Close all positions**, wait until the positions are sold, then use **Withdraw funds**. Withdraw USDG first and ETH last.
