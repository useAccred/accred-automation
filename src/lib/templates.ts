import type { ConnectionKind } from "./connections/kinds";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: "Digest" | "Alert" | "Triage" | "Relay";
  instruction: string;
  trigger: { type: "schedule"; cron: string } | { type: "webhook" } | { type: "manual" };
  /** Connection kinds the instruction relies on. */
  connections: ConnectionKind[];
  /** Text shown on cards, e.g. "Every day at 08:00". */
  triggerLabel: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "inbox-digest",
    name: "Inbox digest to Telegram",
    description: "Reads your unread email and sends you the ones that matter, with a one-line summary each.",
    category: "Digest",
    instruction:
      "Search Gmail for \"is:unread newer_than:1d -category:promotions -category:social\". " +
      "Pick the emails that need my attention: from real people, about money, deadlines, security or work. Skip newsletters and automated notices. " +
      "Read an email only when its preview is not enough to summarize it. " +
      "Send one Telegram message listing each chosen email as: sender, subject, and one sentence on what it wants from me. " +
      "If nothing needs attention, send nothing.",
    trigger: { type: "schedule", cron: "0 8 * * *" },
    connections: ["gmail", "telegram"],
    triggerLabel: "Every day at 08:00",
  },
  {
    id: "morning-briefing",
    name: "Morning news briefing",
    description: "Reads the feeds you care about and sends five bullet points to Telegram.",
    category: "Digest",
    instruction:
      "Read the feed at https://hnrss.org/frontpage. Pick the five most important stories for a software founder. " +
      "Send one Telegram message with a short headline, one sentence on why it matters, and the link for each.",
    trigger: { type: "schedule", cron: "0 8 * * *" },
    connections: ["telegram"],
    triggerLabel: "Every day at 08:00",
  },
  {
    id: "price-alert",
    name: "Price alert",
    description: "Checks a price every hour and messages you only when it crosses your line.",
    category: "Alert",
    instruction:
      "Fetch https://api.coinbase.com/v2/prices/ETH-USD/spot and read the ETH price in USD (the \"amount\" field). " +
      "Read memory to see the last price you alerted on. If the price is below 2000 or above 4000 and you have not " +
      "already alerted for that side, send a Telegram message with the price, then save the alert in memory. " +
      "Otherwise do nothing.",
    trigger: { type: "schedule", cron: "0 * * * *" },
    connections: ["telegram"],
    triggerLabel: "Every hour",
  },
  {
    id: "page-watch",
    name: "Watch a page for changes",
    description: "Remembers what a page said last time and tells you what changed.",
    category: "Alert",
    instruction:
      "Fetch https://example.com/changelog and note the newest entries. Compare them with what is saved in memory. " +
      "If there is something new, post a short summary of the changes to Slack and save the newest entry in memory. " +
      "If nothing changed, do nothing.",
    trigger: { type: "schedule", cron: "0 */6 * * *" },
    connections: ["slack"],
    triggerLabel: "Every 6 hours",
  },
  {
    id: "github-triage",
    name: "Triage new GitHub issues",
    description: "Labels unlabelled issues and leaves a first reply asking for what is missing.",
    category: "Triage",
    instruction:
      "Search the repository for open issues that have no labels. For each one, up to five, read it, add the best " +
      "fitting label from: bug, feature, question, docs. If the report lacks steps to reproduce or version details, " +
      "comment politely asking for exactly what is missing.",
    trigger: { type: "schedule", cron: "0 * * * *" },
    connections: ["github"],
    triggerLabel: "Every hour",
  },
  {
    id: "weekly-digest",
    name: "Weekly shipping digest",
    description: "Summarizes what merged this week and posts it to your Discord channel.",
    category: "Digest",
    instruction:
      "Search the repository for pull requests merged in the last 7 days. Group them into Features, Fixes and Other. " +
      "Post one Discord message with a one-line summary per pull request and its link. Keep it under 1,800 characters.",
    trigger: { type: "schedule", cron: "0 9 * * 1" },
    connections: ["github", "discord"],
    triggerLabel: "Mondays at 09:00",
  },
  {
    id: "webhook-relay",
    name: "Explain incoming webhooks",
    description: "Turns raw webhook payloads from any service into a readable Slack message.",
    category: "Relay",
    instruction:
      "The trigger payload is an event from another service. Work out what happened and post a two-line Slack message: " +
      "what happened, and what someone should do about it, if anything. Skip events that are routine noise.",
    trigger: { type: "webhook" },
    connections: ["slack"],
    triggerLabel: "When a webhook arrives",
  },
];

export function getTemplate(id: string | undefined): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
