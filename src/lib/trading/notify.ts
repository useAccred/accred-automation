import { and, eq, inArray } from "drizzle-orm";
import { toolsFor, type ToolContext } from "../agent/tools";
import { isConnectionKind, type ConnectionKind } from "../connections/kinds";
import { decrypt } from "../crypto";
import { connections, db, type TradingAutomation } from "../db";

/** The message tool each connection type sends with. A connection can only carry text out; it grants nothing else. */
const SENDERS: Partial<Record<ConnectionKind, { tool: string; args: (text: string) => Record<string, unknown> }>> = {
  telegram: { tool: "telegram.send_message", args: (text) => ({ text }) },
  slack: { tool: "slack.post_message", args: (text) => ({ text }) },
  discord: { tool: "discord.post_message", args: (text) => ({ text }) },
  // A linked HTTP API receives the event as a webhook.
  http: { tool: "http.request", args: (text) => ({ method: "POST", path: "", body: { source: "accred-trading-agent", text } }) },
};

/**
 * Sends a plain-text notice to the agent's linked connections. Written by the
 * backend from recorded facts, never by the model. Failures are swallowed: a
 * message that cannot be delivered must not stop a protective exit.
 */
export async function notifyTrading(automation: Pick<TradingAutomation, "userId" | "name" | "permissions" | "connectionIds" | "mode">, text: string): Promise<void> {
  if (!automation.permissions.includes("SEND_NOTIFICATION") || automation.connectionIds.length === 0) return;
  try {
    const rows = await db
      .select()
      .from(connections)
      .where(and(eq(connections.userId, automation.userId), inArray(connections.id, automation.connectionIds)));
    const message = `${automation.name} (${automation.mode === "paper" ? "Paper" : "Live"})\n${text}`.slice(0, 1800);
    await Promise.all(
      rows.map(async (row) => {
        if (!isConnectionKind(row.kind)) return;
        const sender = SENDERS[row.kind];
        const tool = sender && toolsFor([row.kind]).find((candidate) => candidate.name === sender.tool);
        if (!sender || !tool) return;
        const context: ToolContext = { configs: { [row.kind]: JSON.parse(decrypt(row.configEnc)) }, saveMemory: async () => {} };
        await tool.run(tool.schema.parse(sender.args(message)), context).catch(() => {});
      }),
    );
  } catch (error) {
    console.error("[trading] notification failed", error instanceof Error ? error.message : "unknown error");
  }
}
