import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { toolsFor, type ToolContext, type ToolDef } from "../agent/tools";
import { getBalance } from "../balance";
import { formatCredits, formatUsd } from "../credits";
import { automations, db, runs, type User, type WebBot } from "../db";
import { timeAgo } from "../format";
import { describeCron } from "../schedule";
import { fmtUsd, signedUsd } from "../trading/format";
import { listTradingAgents } from "../trading/queries";
import type { ConnectionKind } from "../connections/kinds";

/**
 * What a web bot can do: the automation tools for the user's connections
 * (web pages, mail, chat apps, GitHub, HTTP), its own memory, and a few
 * read-only views of the account. Write tools never run from the model; the
 * engine turns them into a confirmation in the thread.
 */

export interface BotToolContext extends ToolContext {
  user: User;
  bot: WebBot;
}

function define<Schema extends z.ZodType>(tool: ToolDef<z.infer<Schema>> & { schema: Schema }): ToolDef {
  return tool as unknown as ToolDef;
}

const accountBalance = define({
  name: "account.balance",
  summary: "The user's Accred credit balance.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "Check the balance",
  async run(_args, context) {
    const balance = await getBalance((context as BotToolContext).user).catch(() => null);
    if (!balance) return "Balance: not known yet. It appears after the first model call.";
    return `Balance: ${formatCredits(balance.micro)} credits (${formatUsd(balance.micro)})${balance.source === "reported" ? `, as of ${timeAgo(balance.at)}` : ""}. 100 credits = $1. Top up on the Wallet page at https://accred.sh.`;
  },
});

const automationsList = define({
  name: "automations.list",
  summary: "The user's automations with their trigger, state and last run.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "List the automations",
  async run(_args, context) {
    const { user } = context as BotToolContext;
    const rows = await db.select().from(automations).where(eq(automations.userId, user.id)).orderBy(desc(automations.createdAt));
    if (rows.length === 0) return "No automations yet. They are created on the Automations page.";
    const lines = await Promise.all(
      rows.map(async (automation) => {
        const [last] = await db.select({ status: runs.status, createdAt: runs.createdAt }).from(runs).where(eq(runs.automationId, automation.id)).orderBy(desc(runs.createdAt)).limit(1);
        const trigger = automation.triggerType === "schedule" && automation.cron ? describeCron(automation.cron) : automation.triggerType === "webhook" ? "webhook" : "manual";
        return `- ${automation.name} (${automation.enabled ? "on" : "paused"}, ${trigger}); last run: ${last ? `${last.status} ${timeAgo(last.createdAt)}` : "never"}`;
      }),
    );
    return lines.join("\n");
  },
});

const tradingOverview = define({
  name: "trading.overview",
  summary: "The user's trading agents: state, allocation, equity, today's and total profit or loss, open positions.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "Check the trading agents",
  async run(_args, context) {
    const { user } = context as BotToolContext;
    const agents = await listTradingAgents(user.id);
    if (agents.length === 0) return "No trading agents. They are created on the Trading page.";
    return agents
      .map((agent) => {
        const p = agent.portfolio;
        return `- ${agent.automation.name}: ${agent.automation.status}; allocation ${fmtUsd(p.allocationUsd)}; equity ${fmtUsd(p.equityUsd)}; realized after fees ${signedUsd(p.realizedNetUsd)}; unrealized ${signedUsd(p.unrealizedUsd)}; open positions ${p.openPositions}${p.openAssets.length ? ` (${p.openAssets.join(", ")})` : ""}.`;
      })
      .join("\n");
  },
});

export const ACCOUNT_TOOLS: ToolDef[] = [accountBalance, automationsList, tradingOverview];

/** The tool set for one bot, given the connection kinds the user has linked. */
export function botTools(kinds: ConnectionKind[]): Map<string, ToolDef> {
  return new Map([...toolsFor(kinds), ...ACCOUNT_TOOLS].map((tool) => [tool.name, tool]));
}
