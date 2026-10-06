import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/status";

export const metadata: Metadata = { title: "Trading agents: user guide" };

// The same words as docs/TRADING_USER_GUIDE.md. Change both together.
const PROSE =
  "mt-3 space-y-3 text-[15px] leading-relaxed text-muted [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h3]:pt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-5 [&_li_ul]:mt-1.5 [&_ol]:space-y-1.5 [&_ol>li]:list-decimal [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:space-y-1.5 [&_ul>li]:list-disc";

function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <div className={PROSE}>{children}</div>
    </section>
  );
}

export default function TradingGuidePage() {
  return (
    <>
      <PageHeader
        eyebrow="Trading · Guide"
        title="Trading agents: user guide"
        description="This guide shows you how to set up a trading agent, how to read what it does, and how to stop it. It is written for users of the app. You do not need to know how to code."
        actions={
          <>
            <Link href="/app/trading" className="btn btn-secondary">
              Back to agents
            </Link>
            <Link href="/app/trading/new" className="btn btn-primary">
              New trading agent
            </Link>
          </>
        }
      />
      <div className="max-w-3xl space-y-9">
        <nav className="card p-5" aria-label="Contents">
          <p className="eyebrow mb-3">Contents</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>
              <a href="#1-what-a-trading-agent-is" className="hover:text-foreground">
                What a trading agent is
              </a>
            </li>
            <li>
              <a href="#2-what-you-need-before-you-start" className="hover:text-foreground">
                What you need before you start
              </a>
            </li>
            <li>
              <a href="#3-step-1-create-a-wallet-and-fund-it" className="hover:text-foreground">
                Step 1: create a wallet and fund it
              </a>
            </li>
            <li>
              <a href="#4-step-2-create-your-agent" className="hover:text-foreground">
                Step 2: create your agent
              </a>
            </li>
            <li>
              <a href="#5-step-3-review-and-approve" className="hover:text-foreground">
                Step 3: review and approve
              </a>
            </li>
            <li>
              <a href="#6-what-happens-after-you-start" className="hover:text-foreground">
                What happens after you start
              </a>
            </li>
            <li>
              <a href="#7-reading-the-agent-page" className="hover:text-foreground">
                Reading the agent page
              </a>
            </li>
            <li>
              <a href="#8-emergency-controls" className="hover:text-foreground">
                Emergency controls
              </a>
            </li>
            <li>
              <a href="#9-pausing-resuming-and-editing" className="hover:text-foreground">
                Pausing, resuming and editing
              </a>
            </li>
            <li>
              <a href="#10-withdrawing-funds" className="hover:text-foreground">
                Withdrawing funds
              </a>
            </li>
            <li>
              <a href="#11-notifications" className="hover:text-foreground">
                Notifications
              </a>
            </li>
            <li>
              <a href="#12-what-it-costs" className="hover:text-foreground">
                What it costs
              </a>
            </li>
            <li>
              <a href="#13-safety-tips-and-risks" className="hover:text-foreground">
                Safety tips and risks
              </a>
            </li>
            <li>
              <a href="#14-questions-and-problems" className="hover:text-foreground">
                Questions and problems
              </a>
            </li>
          </ol>
        </nav>

        <Section id="1-what-a-trading-agent-is" heading="1. What a trading agent is">
          <p>A trading agent is an AI model that trades for you inside limits that you set. You do not give it your wallet. You give it a <strong>mandate</strong>: a separate wallet, a maximum amount it may use, strict risk rules, and a list of tokens it may trade. The model studies the market and proposes trades. The app checks every proposal against your rules before anything moves. A proposal that breaks a rule is rejected, whatever the model says.</p>
          <p>Agents trade with <strong>real funds on Robinhood Chain mainnet</strong>. They buy tokens with <strong>USDG</strong>, the dollar stablecoin of the chain, and sell them back to USDG. There is no practice mode.</p>
        </Section>

        <Section id="2-what-you-need-before-you-start" heading="2. What you need before you start">
          <ul>
            <li><strong>An Accred API key with credits.</strong> You sign in with it. Each time the agent asks the model, the cost is paid from your credits. 100 credits = $1.</li>
            <li><strong>A trading wallet.</strong> A wallet used only for this agent. You create it in the app in Step 1. Never use your main wallet.</li>
            <li><strong>USDG in that wallet.</strong> The agent buys positions with USDG.</li>
            <li><strong>A little ETH in that wallet.</strong> Every transaction on the chain needs a small network fee, paid in ETH.</li>
          </ul>
        </Section>

        <Section id="3-step-1-create-a-wallet-and-fund-it" heading="3. Step 1: create a wallet and fund it">
          <ol>
            <li>Open <Link href="/app/trading"><strong>Trading</strong></Link> in the top menu, then press <Link href="/app/trading/wallets"><strong>Wallets</strong></Link>.</li>
            <li>Under <strong>Create a wallet</strong>, type a name if you want one, and press <strong>Create wallet</strong>. This is the recommended way: a fresh wallet that has never been used for anything else.</li>
            <li>Your new wallet appears in the list with its address.</li>
            <li>Under <strong>Deposit</strong>, copy the <strong>Deposit address</strong>.</li>
            <li>From your own wallet or exchange, send <strong>USDG</strong> and a little <strong>ETH</strong> to that address <strong>on Robinhood Chain (chain ID 4663)</strong>.</li>
            <li>Wait for the transfer to arrive. The page shows <strong>Wallet balance</strong>, <strong>ETH</strong> and <strong>USDG</strong> live from the chain.</li>
          </ol>
          <p>Important:</p>
          <ul>
            <li>Funds sent on another network cannot be recovered. Check the network before you send.</li>
            <li>The key of a wallet you create is made on the server and stored encrypted. It is never shown, never given to a model and never written to a log.</li>
          </ul>
          <p><strong>Already have a wallet made for this purpose?</strong> Use <strong>Import a wallet</strong> instead. Paste its <strong>Private key</strong>, tick the box that says the wallet was made only for this agent, and press <strong>Import wallet</strong>. Do not import a wallet that holds anything else.</p>
        </Section>

        <Section id="4-step-2-create-your-agent" heading="4. Step 2: create your agent">
          <p>Open <Link href="/app/trading"><strong>Trading</strong></Link> and press <Link href="/app/trading/new"><strong>New trading agent</strong></Link>. The form has nine numbered sections. Fill them in from top to bottom.</p>
          <h3>01 · Agent and model</h3>
          <ul>
            <li><strong>Name.</strong> Any name that helps you recognise the agent.</li>
            <li><strong>AI model.</strong> You can let Accred pick for you, or choose the model yourself.<ul>
            <li><strong>Auto</strong>: a strong model studies the market each cycle.</li>
            <li><strong>Economy</strong>: a fast, cheap model. Lowest cost per cycle.</li>
            <li><strong>Best quality</strong>: a top model. Costs several times more per cycle.</li>
            <li><strong>Or choose the model yourself</strong>: press one of the top models, such as Claude, GPT, Gemini, Grok, DeepSeek, Kimi or Qwen. Each one is shown with its logo, its maker and its price.</li>
            <li><strong>Any other model</strong>: type a name in the search box to pick any model in the Accred catalog.</li>
            </ul></li>
          </ul>
          <p>Auto, Economy and Best quality each show the model they use right now. Prices are US dollars per 1 million tokens, paid from your Accred credits. A model marked <strong>Premium</strong> costs the most for each cycle, and one marked <strong>Low cost</strong> the least.</p>
          <p>The model only proposes trades. It holds no keys and cannot move funds.</p>
          <h3>02 · Dedicated wallet</h3>
          <p>Choose the wallet the agent will trade from. The wallet needs USDG to buy positions with and a little ETH for network fees before the agent can trade. If you have no wallet yet, go back to Step 1.</p>
          <h3>03 · Agent allocation</h3>
          <p>In <strong>The most the agent may deploy ($)</strong>, type the largest amount the agent may use. The minimum is $10.</p>
          <ul>
            <li>This is a hard cap. Profits are not added to it, and it is never raised without your approval.</li>
            <li>The rest of the wallet is shown as <strong>Outside the agent&apos;s reach</strong>.</li>
            <li>A trade larger than the USDG the wallet really holds is refused.</li>
          </ul>
          <p>Example: the wallet holds $5,000 and the allocation is $1,000. The agent can never use the other $4,000.</p>
          <h3>04 · Strategy</h3>
          <p>Under <strong>What the agent looks for</strong>, pick one or more strategies:</p>
          <ul>
            <li><strong>Momentum</strong>: price rising over the last hour and the last six.</li>
            <li><strong>Breakout</strong>: a sharp move in the last hour on real volume.</li>
            <li><strong>Trend following</strong>: up over a day and still up over six hours.</li>
            <li><strong>Mean reversion</strong>: a sharp dip in an asset that is not in free fall.</li>
            <li><strong>Volume expansion</strong>: trading volume well above its recent average.</li>
          </ul>
          <p>Each strategy is a fixed screen that runs first. The model is only called, and credits only spent, when a token passes one.</p>
          <ul>
            <li><strong>In your own words (optional).</strong> Describe what you want in plain language. This guides what the model proposes. It can never override your limits.</li>
            <li><strong>How often it looks at the market.</strong> From <strong>Every 5 minutes</strong> to <strong>Once a day</strong>. Stops and targets are checked about every 20 seconds, whatever you choose here.</li>
          </ul>
          <p>You must pick at least one strategy, or describe one in your own words.</p>
          <h3>05 · Risk mandate</h3>
          <p>These are hard limits enforced by the app, not suggestions to the model.</p>
          <p>Start with a profile. A profile only fills in the fields below it. There are no hidden rules.</p>
          <ul>
            <li><strong>Conservative</strong>: small positions, tight stops, deep liquidity only.</li>
            <li><strong>Balanced</strong>: moderate positions with a 2% stop and a 5% target.</li>
            <li><strong>Aggressive</strong>: larger positions, wider stops, thinner markets allowed.</li>
            <li><strong>Custom</strong>: selected as soon as you edit any limit.</li>
          </ul>
          <p>Then check each group and change what you want:</p>
          <ul>
            <li><strong>Capital.</strong> How much the agent may deploy, in total and per position. For example <strong>Largest position</strong>, <strong>Total open exposure</strong>, <strong>Open positions at once</strong> and <strong>Untouchable reserve</strong>.</li>
            <li><strong>Loss.</strong> When the agent must stop. For example <strong>Largest loss per trade</strong>, <strong>Daily loss limit</strong>, <strong>Maximum drawdown</strong>, <strong>Losses in a row</strong> and <strong>Cooldown after a loss</strong>. Reaching any of these pauses new trading automatically.</li>
            <li><strong>Position.</strong> How each position is protected. For example <strong>Default stop loss</strong>, <strong>Widest stop loss</strong>, <strong>Default take profit</strong>, <strong>Minimum risk/reward</strong>, <strong>Trailing stop</strong>, <strong>Break-even trigger</strong>, <strong>Partial profit at</strong> and <strong>Longest time in a position</strong>.</li>
            <li><strong>Execution.</strong> What a trade must look like at the moment it is made. For example <strong>Slippage allowed</strong>, <strong>Price impact allowed</strong>, <strong>Minimum liquidity</strong>, <strong>Minimum market cap</strong>, <strong>Minimum token age</strong> and <strong>Network fee allowed</strong>.</li>
            <li><strong>Frequency.</strong> How often the agent may trade: <strong>Trades per hour</strong>, <strong>Trades per day</strong> and <strong>Cooldown between trades</strong>.</li>
          </ul>
          <p>Two switches:</p>
          <ul>
            <li><strong>Every proposal must state its stop loss.</strong> When on, a proposal without a stop loss is rejected. When off, the default stop loss is applied instead. Either way, no position is ever open without a stop.</li>
            <li><strong>Only open positions during set hours.</strong> Choose the hours and days. Exits are enforced at all hours.</li>
          </ul>
          <p>Each field has a short explanation under it. Read them before you change a number.</p>
          <h3>06 · Assets</h3>
          <p>The agent may only trade what you select here. Nothing is allowed by default.</p>
          <ul>
            <li>Press a token in the list of the most traded tokens on Robinhood Chain to add it.</li>
            <li>Or paste a token address under <strong>Add a token by address</strong> and press <strong>Add</strong>.</li>
            <li><strong>Blocklist (optional)</strong>: token addresses the agent must never trade, one per line.</li>
          </ul>
          <p>You must select at least one asset.</p>
          <h3>07 · Mode</h3>
          <p>There is one mode: <strong>Live on Robinhood Chain mainnet</strong>, with real funds. Every trade is a real swap from the agent&apos;s wallet. Each one is simulated on the chain first and only signed if that passes.</p>
          <h3>08 · Notifications and credits</h3>
          <ul>
            <li><strong>Send notices to.</strong> Pick the connections that should receive messages about this agent. See <a href="#11-notifications">Notifications</a>.</li>
            <li><strong>Credit budget per cycle.</strong> The most one cycle may spend on the model, from 0.1 to 100 credits. The model is not called if the call could cost more.</li>
            <li><strong>Credit cap per month.</strong> The agent stops asking the model once this is reached. Open positions stay protected.</li>
          </ul>
          <h3>09 · Review permissions and limits</h3>
          <p>This section lists what the agent is allowed to do: <strong>Read market data</strong>, <strong>Read balances</strong>, <strong>Propose trades</strong>, <strong>Open positions</strong>, <strong>Close positions</strong>, <strong>Manage protective exits</strong> and <strong>Send notifications</strong>. The ones marked <strong>Sensitive</strong> can move funds inside your limits. An agent that may open positions must also be able to protect and close them, so those boxes stay ticked.</p>
          <p>Below the list, <strong>With this mandate the agent:</strong> sums up your limits in plain sentences.</p>
        </Section>

        <Section id="5-step-3-review-and-approve" heading="5. Step 3: review and approve">
          <ol>
            <li>Read the summary under <strong>With this mandate the agent:</strong>. Check the amounts and the token list.</li>
            <li>Tick <strong>I have reviewed these permissions and limits and approve them</strong>.</li>
            <li>Tick <strong>I understand this agent trades real funds from its wallet</strong>. Losses are real and trades on the chain cannot be undone. The limits cap what the agent can lose. They do not prevent loss.</li>
            <li>Press <strong>Approve and start trading</strong>.</li>
          </ol>
          <p>The agent starts trading as soon as you approve. You can pause it at any time.</p>
        </Section>

        <Section id="6-what-happens-after-you-start" heading="6. What happens after you start">
          <p>The agent works in <strong>cycles</strong>. The first cycle starts within a minute. After that, a cycle runs as often as you chose in section 04.</p>
          <p>In each cycle:</p>
          <ol>
            <li>The app reads prices for your selected tokens.</li>
            <li>It applies your market filters and your strategy screens. If no token passes, the model is not called and no credits are spent.</li>
            <li>If a token passes, the model is asked once. It may propose up to three trades.</li>
            <li>Each proposal goes through <strong>17 risk checks</strong>. If one check fails, the proposal is rejected. The model cannot override a rejection.</li>
            <li>A proposal that passes is simulated on the chain from your wallet. If the simulation passes, the swap is signed and sent.</li>
            <li>The position is then watched about every 20 seconds, without the model. It is sold when it reaches its stop loss, its take profit, its trailing stop or its time limit.</li>
          </ol>
          <p>Common reasons a proposal is rejected:</p>
          <ul>
            <li>The position is larger than your limits allow.</li>
            <li>The token has too little liquidity, or is not on your list.</li>
            <li>The stop loss is missing or too wide, or the risk/reward is too low.</li>
            <li>The wallet does not hold enough USDG, or enough ETH for the network fee.</li>
            <li>A daily loss limit, a drawdown limit or a cooldown is active.</li>
            <li>The trade would move the price too much, or the simulation failed.</li>
          </ul>
          <p>A rejection is the system working as planned. It costs nothing on the chain.</p>
        </Section>

        <Section id="7-reading-the-agent-page" heading="7. Reading the agent page">
          <p>Open <Link href="/app/trading"><strong>Trading</strong></Link> and press your agent. At the top you see its state: <strong>Live · mainnet</strong>, and <strong>Running</strong>, <strong>Paused</strong>, <strong>Auto-paused</strong> or <strong>Stopped</strong>.</p>
          <ul>
            <li><strong>The numbers at the top.</strong> <strong>Agent allocation</strong>, <strong>Available capital</strong>, <strong>Open exposure</strong>, <strong>Drawdown</strong>, <strong>Realized PnL</strong> (sold positions, less every fee paid), <strong>Unrealized PnL</strong> (open positions at the last price), <strong>Today</strong> and <strong>Total PnL</strong>.</li>
            <li><strong>Open positions.</strong> What the agent holds now, with the <strong>Stop loss</strong> and <strong>Take profit</strong> price of each. Press <strong>Close</strong> on a position to sell it at the market price.</li>
            <li><strong>Decisions.</strong> Every proposal the model made, including the ones that were rejected. Each one shows <strong>Confidence</strong>, <strong>Requested position</strong>, <strong>Stop loss</strong>, <strong>Take profit</strong>, <strong>Maximum planned loss</strong> and <strong>Risk checks</strong> (for example 17/17 passed). Open a check to see why it passed or failed.</li>
            <li><strong>Trades.</strong> Every swap the agent made or attempted, with a link to the transaction. PnL is computed from these.</li>
            <li><strong>Cycles.</strong> One line per cycle: what happened, which model was used, the tokens in and out, and the credits charged. <strong>No model call</strong> means the cycle cost 0 credits.</li>
            <li><strong>Activity.</strong> The latest events. Press <strong>Full audit log</strong> to see everything the agent did, and why. Entries are only ever added. Keys and secrets are never recorded.</li>
            <li><strong>Closed positions.</strong> Past positions and their result.</li>
            <li><strong>Net result after costs.</strong> <strong>Gross trading PnL</strong>, less <strong>Swap fees</strong>, <strong>Network fees</strong> and <strong>LLM cost</strong>, gives the <strong>Net result</strong>. You also see <strong>LLM credits charged</strong> and how many cycles made a model call.</li>
            <li><strong>Results so far.</strong> <strong>Closed trades</strong>, <strong>Win rate</strong>, <strong>Average win</strong>, <strong>Average loss</strong>, <strong>Max drawdown</strong>, <strong>Average slippage</strong>, and <strong>Why proposals were rejected</strong>.</li>
            <li><strong>Your limits.</strong> The mandate now in force. Open <strong>All limits</strong> to see every one.</li>
          </ul>
          <p>Two buttons at the top: <strong>Edit mandate</strong> changes the agent&apos;s settings. <strong>Run a cycle now</strong> starts a cycle without waiting.</p>
        </Section>

        <Section id="8-emergency-controls" heading="8. Emergency controls">
          <p>These are always on the agent page.</p>
          <ul>
            <li><strong>Pause agent.</strong> Stops new positions at once. Stop loss, take profit and time limits keep running on what is open.</li>
            <li><strong>Close all positions.</strong> Pauses the agent, then sells every open position at the current market price. A position that cannot be priced, or whose sale fails, stays open under its stop loss, and you are told.</li>
            <li><strong>Revoke trading access.</strong> Removes the agent&apos;s permission to propose or open trades. Open positions stay protected. Starting again needs a fresh approval.</li>
            <li><strong>Withdraw funds.</strong> Opens the wallet with the withdrawal form ready. Only you can move funds out. The agent never can.</li>
          </ul>
          <p>There is one more control on the <Link href="/app/trading/wallets"><strong>Wallets</strong></Link> page: <strong>Revoke trading authority</strong>. It stops every agent that uses that wallet from opening positions, at once. Protective exits on open positions continue. You can restore it later with <strong>Restore trading authority</strong>.</p>
        </Section>

        <Section id="9-pausing-resuming-and-editing" heading="9. Pausing, resuming and editing">
          <p><strong>Pause and resume.</strong> Press <strong>Pause agent</strong> to stop new positions. Press <strong>Resume agent</strong> to start again.</p>
          <p><strong>Automatic pauses.</strong> The agent pauses itself when a safety limit is reached. The page then shows <strong>Auto-paused</strong> and the reason. This happens on:</p>
          <ul>
            <li>the daily loss limit, the drawdown limit, or too many losses in a row;</li>
            <li>prices that are missing or out of date, or a market data provider that keeps failing;</li>
            <li>simulations or sales that keep failing;</li>
            <li>a trade that slipped far more than your limit;</li>
            <li>a wallet that holds less than the agent&apos;s positions say it should;</li>
            <li>any state the app cannot read.</li>
          </ul>
          <p>A pause never stops protective exits. Resuming is always done by you. After an automatic pause, resuming restarts the loss streak and the drawdown measure from the current value of the agent.</p>
          <p><strong>Editing.</strong> Press <strong>Edit mandate</strong>, change what you want, tick the approval boxes and press <strong>Approve and save changes</strong>.</p>
          <ul>
            <li>Saving creates a new version of the mandate. Every trade records the version that approved it.</li>
            <li>If a change lets the agent risk more, the app lists it under <strong>These changes let the agent risk more than before</strong>. You must tick <strong>I understand and approve these increases</strong> to save.</li>
            <li>Open positions keep the exit rules of the version that approved them. Changes apply to new trades.</li>
            <li>While positions are open, you cannot remove the permissions that protect them. Close the positions first.</li>
          </ul>
          <p><strong>After you revoked access.</strong> Press <strong>Review and re-approve</strong>, check the permissions and approve them again. This grants access again and restarts the agent.</p>
          <p><strong>Deleting.</strong> <strong>Delete agent</strong> is at the bottom of the agent page. Close all open positions first.</p>
        </Section>

        <Section id="10-withdrawing-funds" heading="10. Withdrawing funds">
          <ol>
            <li>Open <Link href="/app/trading"><strong>Trading</strong></Link>, then <Link href="/app/trading/wallets"><strong>Wallets</strong></Link>. Or press <strong>Withdraw funds</strong> on the agent page.</li>
            <li>Open <strong>Withdraw funds</strong> on the wallet.</li>
            <li>Choose the <strong>Asset</strong>: <strong>USDG</strong> or <strong>ETH</strong>.</li>
            <li>Type the <strong>Amount</strong>, or press <strong>Max</strong>.</li>
            <li>In <strong>Send to</strong>, paste the address on Robinhood Chain that should receive the funds.</li>
            <li>Tick the box to confirm that you checked the address.</li>
            <li>Press <strong>Withdraw</strong>.</li>
          </ol>
          <p>Good to know:</p>
          <ul>
            <li>A transfer on Robinhood Chain cannot be undone. Check the address twice.</li>
            <li>The transfer is simulated first and only signed if that passes.</li>
            <li>The network fee is paid in ETH, so withdraw ETH last.</li>
            <li>Tokens held in open positions are not USDG yet. Use <strong>Close all positions</strong> first to sell them back to USDG.</li>
            <li><strong>Remove wallet</strong> is only possible when the wallet holds no ETH or USDG and no agent uses it. Other tokens are not checked: anything left in the wallet is lost with its key.</li>
          </ul>
        </Section>

        <Section id="11-notifications" heading="11. Notifications">
          <p>The agent can send you a message when something happens.</p>
          <ol>
            <li>Open <Link href="/app/connections"><strong>Connections</strong></Link> in the top menu and add Telegram, Slack or Discord.</li>
            <li>In the agent form, section 08, pick the connection under <strong>Send notices to</strong>.</li>
          </ol>
          <p>You are told about executions, rejections, stop loss and take profit, loss limits, automatic pauses, failures and manual stops.</p>
          <p>A connection can only carry messages out. It never grants trading authority.</p>
        </Section>

        <Section id="12-what-it-costs" heading="12. What it costs">
          <ul>
            <li><strong>Model credits.</strong> Each cycle that calls the model is paid from your Accred credits. 100 credits = $1. A cycle that does not call the model costs 0 credits. Your <strong>Credit budget per cycle</strong> and <strong>Credit cap per month</strong> limit this.</li>
            <li><strong>Network fees (gas).</strong> Each transaction on the chain is paid in ETH from the trading wallet. A buy is two transactions: an approval, then the swap. A trade that fails on the chain still pays its gas.</li>
            <li><strong>Pool and router fees.</strong> These are inside the price you get when you buy and sell. They show up in your trading PnL, not as a separate line.</li>
          </ul>
          <p>The agent page shows the <strong>Net result</strong> after all of these.</p>
        </Section>

        <Section id="13-safety-tips-and-risks" heading="13. Safety tips and risks">
          <ul>
            <li><strong>This is real money.</strong> The agent can lose money. The limits cap the loss. They do not prevent it.</li>
            <li><strong>Start small.</strong> Begin with a small allocation and a small largest position. Watch a few trades before you raise anything.</li>
            <li><strong>Use a dedicated wallet.</strong> Keep only what you are prepared to allocate in it.</li>
            <li><strong>Be careful with thin tokens.</strong> A token with little liquidity costs more to buy and to sell. The price you get can be several percent worse than the market price.</li>
            <li><strong>A stop loss can sell by itself.</strong> When the price falls to the stop, the position is sold without asking you. In a fast market the sale price can be lower than the stop price.</li>
            <li><strong>Some tokens cannot be sold.</strong> A token that blocks transfers or taxes sales can fail its exit. You choose the list of tokens, so choose tokens you know.</li>
            <li><strong>Trades cannot be undone.</strong> A swap or a transfer on the chain is final.</li>
            <li><strong>Keep a little ETH in the wallet.</strong> Without ETH for the network fee, the agent cannot buy, and it cannot sell.</li>
            <li><strong>Check the agent regularly.</strong> Turn on notifications so you know when it trades or pauses.</li>
          </ul>
        </Section>

        <Section id="14-questions-and-problems" heading="14. Questions and problems">
          <p><strong>The cycle says &quot;The model was not called&quot;.</strong><br />No token passed your market filters and strategy screens, or a limit already blocked new positions. Nothing was spent. This is normal.</p>
          <p><strong>My agent shows &quot;Auto-paused&quot;.</strong><br />A safety limit was reached. The reason is shown at the top of the agent page. Open positions are still protected. Read the reason, fix the cause if there is one, then press <strong>Resume agent</strong>.</p>
          <p><strong>A trade failed because there was not enough ETH.</strong><br />The wallet could not pay the network fee. Send a little more ETH to the wallet on Robinhood Chain and wait for the next cycle.</p>
          <p><strong>The page says &quot;Live trading is switched off on this server&quot;.</strong><br />Trading is turned off for the whole site, so an agent cannot be started or changed yet. Your funds are not affected. Try again later.</p>
          <p><strong>Every proposal is rejected.</strong><br />Open the proposal under <strong>Decisions</strong> and look at the failed check. Often the largest position is too small for the model&apos;s request, the token has less liquidity than your minimum, or the wallet holds too little USDG.</p>
          <p><strong>A trade shows &quot;Sent, waiting for the chain to confirm&quot;.</strong><br />The swap was sent and the app is waiting for the chain. Its amount stays reserved, so it cannot be spent twice. The app settles it by itself.</p>
          <p><strong>I cannot press &quot;Approve and start trading&quot;.</strong><br />The button is greyed out when you have no trading wallet, or when live trading is off for the site. If you can press it but the form is not saved, tick both approval boxes and select at least one asset.</p>
          <p><strong>The page says trading authority is revoked for the wallet.</strong><br />Open <Link href="/app/trading/wallets"><strong>Wallets</strong></Link> and press <strong>Restore trading authority</strong> on that wallet.</p>
          <p><strong>My agent says it was created in Paper Mode.</strong><br />Paper Mode has been retired. That agent no longer runs. Create a new agent to trade.</p>
          <p><strong>I want everything out now.</strong><br />Press <strong>Close all positions</strong>, wait until the positions are sold, then use <strong>Withdraw funds</strong>. Withdraw USDG first and ETH last.</p>
        </Section>
      </div>
    </>
  );
}
