import { z } from "zod";
import type { ConnectionKind } from "../connections/kinds";
import { GmailAccessError, readGmail, searchGmail } from "../connections/gmail";
import { env } from "../env";
import { feedToText, htmlToText, isFeed } from "./extract";
import { safeFetch } from "./safe-fetch";

export type ToolEffect = "read" | "write" | "internal";
type Config = Record<string, string>;

export interface ToolContext {
  /** Decrypted connection settings, one connection per kind. */
  configs: Partial<Record<ConnectionKind, Config>>;
  saveMemory(text: string): Promise<void>;
}

export interface ToolDef<Args = Record<string, unknown>> {
  name: string;
  summary: string;
  /** Shown to the model, e.g. `{"url": string}`. */
  argsHint: string;
  schema: z.ZodType<Args>;
  /** Write tools change something outside and can require approval. */
  effect: ToolEffect | ((args: Args) => ToolEffect);
  kind?: ConnectionKind;
  /** One line for the run log and the approval prompt. */
  title(args: Args): string;
  run(args: Args, context: ToolContext): Promise<string>;
}

/** A failure the model should see and can react to. */
export class ToolError extends Error {}

function config(context: ToolContext, kind: ConnectionKind): Config {
  const value = context.configs[kind];
  if (!value) throw new ToolError(`No ${kind} connection is linked to this automation.`);
  return value;
}

function quote(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return `"${flat.length > max ? `${flat.slice(0, max)}…` : flat}"`;
}

function define<Schema extends z.ZodType>(tool: ToolDef<z.infer<Schema>> & { schema: Schema }): ToolDef {
  return tool as unknown as ToolDef;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return safeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function failed(service: string, response: { status: number; text: string }): ToolError {
  return new ToolError(`${service} returned ${response.status}: ${response.text.slice(0, 300)}`);
}

// ── Built in ────────────────────────────────────────────────────────────────

const webFetch = define({
  name: "web.fetch",
  summary: "Fetch a public web page, JSON API or RSS feed and return its text.",
  argsHint: '{"url": string}',
  schema: z.object({ url: z.string().min(8).max(2000) }),
  effect: "read",
  title: (args) => `Read ${args.url}`,
  async run(args) {
    const read = () =>
      safeFetch(args.url, {
        headers: { "user-agent": "AccredAutomation/1.0 (+https://agent.accred.sh)", accept: "*/*" },
      });
    let response = await read();
    if (response.status === 429 || response.status === 503) {
      // A short pause clears most momentary limits; a second refusal means the site is limiting this server.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      response = await read();
    }
    if (response.status === 429) {
      throw new ToolError(
        "This site is limiting how often this server may read it (HTTP 429). Trying again in this run will not help. Finish and report that the source is rate limited.",
      );
    }
    if (!response.ok) throw new ToolError(`The page returned HTTP ${response.status}.`);
    if (isFeed(response.text)) return feedToText(response.text);
    if (/html/i.test(response.contentType) || /^\s*<(!doctype|html)/i.test(response.text)) return htmlToText(response.text);
    return response.text;
  },
});

const memorySave = define({
  name: "memory.save",
  summary: "Replace your saved memory for this job. Later runs see it. Keep it short: only what the next run needs.",
  argsHint: '{"text": string}',
  schema: z.object({ text: z.string().max(4000) }),
  effect: "internal",
  title: (args) => `Save to memory ${quote(args.text)}`,
  async run(args, context) {
    await context.saveMemory(args.text);
    return "Saved.";
  },
});

// ── Messaging ───────────────────────────────────────────────────────────────

const telegramSend = define({
  name: "telegram.send_message",
  summary: "Send a plain-text message to the user's Telegram chat (max 4,000 characters).",
  argsHint: '{"text": string}',
  schema: z.object({ text: z.string().min(1).max(12_000) }),
  effect: "write",
  kind: "telegram",
  title: (args) => `Send Telegram message ${quote(args.text)}`,
  async run(args, context) {
    const { botToken, chatId } = config(context, "telegram");
    // Chats linked through the shared bot carry no token of their own.
    const token = botToken ?? env.telegramBotToken;
    if (!token) throw new ToolError("The Telegram bot is not configured on this server.");
    const response = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: args.text.slice(0, 4000),
      disable_web_page_preview: true,
    });
    if (!response.ok) throw failed("Telegram", response);
    return "Message sent.";
  },
});

const slackPost = define({
  name: "slack.post_message",
  summary: "Post a message to the user's Slack channel.",
  argsHint: '{"text": string}',
  schema: z.object({ text: z.string().min(1).max(12_000) }),
  effect: "write",
  kind: "slack",
  title: (args) => `Post to Slack ${quote(args.text)}`,
  async run(args, context) {
    const response = await postJson(config(context, "slack").webhookUrl!, { text: args.text.slice(0, 8000) });
    if (!response.ok) throw failed("Slack", response);
    return "Message posted.";
  },
});

const discordPost = define({
  name: "discord.post_message",
  summary: "Post a message to the user's Discord channel (max 2,000 characters).",
  argsHint: '{"text": string}',
  schema: z.object({ text: z.string().min(1).max(12_000) }),
  effect: "write",
  kind: "discord",
  title: (args) => `Post to Discord ${quote(args.text)}`,
  async run(args, context) {
    const response = await postJson(config(context, "discord").webhookUrl!, {
      content: args.text.slice(0, 2000),
      // Never let generated text ping @everyone or roles.
      allowed_mentions: { parse: [] },
    });
    if (!response.ok) throw failed("Discord", response);
    return "Message posted.";
  },
});

// ── Gmail (read-only) ───────────────────────────────────────────────────────

async function gmail<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // Tell the model plainly so it stops instead of retrying a revoked grant.
    if (error instanceof GmailAccessError) throw new ToolError(error.message);
    throw error;
  }
}

const gmailSearch = define({
  name: "gmail.search",
  summary:
    'Search the user\'s Gmail with Gmail search syntax, e.g. "is:unread newer_than:1d" or "from:billing@example.com". Returns sender, subject, date, a preview and an id for each match.',
  argsHint: '{"query": string, "max"?: number (1-15, default 10)}',
  schema: z.object({ query: z.string().max(300), max: z.coerce.number().int().min(1).max(15).default(10) }),
  effect: "read",
  kind: "gmail",
  title: (args) => `Search Gmail: ${args.query || "all mail"}`,
  run: (args, context) => gmail(() => searchGmail(config(context, "gmail").refreshToken!, args.query, args.max)),
});

const gmailRead = define({
  name: "gmail.read",
  summary: "Read the full text of one email, by the id that gmail.search returned.",
  argsHint: '{"id": string}',
  schema: z.object({ id: z.string().regex(/^[\w-]{6,64}$/, "Use an id returned by gmail.search") }),
  effect: "read",
  kind: "gmail",
  title: (args) => `Read email ${args.id}`,
  run: (args, context) => gmail(() => readGmail(config(context, "gmail").refreshToken!, args.id)),
});

// ── GitHub ──────────────────────────────────────────────────────────────────

async function github(context: ToolContext, method: string, path: string, body?: unknown) {
  const { token } = config(context, "github");
  const response = await safeFetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "AccredAutomation/1.0",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw failed("GitHub", response);
  return JSON.parse(response.text) as Record<string, unknown>;
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  updated_at: string;
  user: { login: string } | null;
  labels: Array<{ name: string } | string>;
  pull_request?: unknown;
}

function issueLine(issue: GithubIssue): string {
  const labels = issue.labels.map((label) => (typeof label === "string" ? label : label.name)).join(", ") || "none";
  const type = issue.pull_request ? "PR" : "issue";
  return `#${issue.number} [${type}, ${issue.state}] ${issue.title} — by ${issue.user?.login ?? "unknown"}, labels: ${labels}, updated ${issue.updated_at} — ${issue.html_url}`;
}

const issueNumber = z.coerce.number().int().positive();

const githubSearch = define({
  name: "github.search",
  summary:
    "Search issues and pull requests in the linked repository with GitHub search qualifiers, e.g. \"is:issue is:open no:label\" or \"is:pr is:merged merged:>=2026-01-31\". Returns up to 20.",
  argsHint: '{"query": string}',
  schema: z.object({ query: z.string().max(300) }),
  effect: "read",
  kind: "github",
  title: (args) => `Search GitHub: ${args.query}`,
  async run(args, context) {
    const { repo } = config(context, "github");
    // The connection is scoped to one repository; drop any attempt to search elsewhere.
    const query = args.query.replace(/\b(repo|org|user):\S+/gi, "").trim();
    const result = await github(
      context,
      "GET",
      `/search/issues?per_page=20&sort=updated&q=${encodeURIComponent(`repo:${repo} ${query}`)}`,
    );
    const items = (result.items ?? []) as GithubIssue[];
    if (items.length === 0) return "No results.";
    return `${result.total_count} results, showing ${items.length}:\n${items.map(issueLine).join("\n")}`;
  },
});

const githubGetIssue = define({
  name: "github.get_issue",
  summary: "Read one issue or pull request with its description and latest comments.",
  argsHint: '{"number": number}',
  schema: z.object({ number: issueNumber }),
  effect: "read",
  kind: "github",
  title: (args) => `Read GitHub #${args.number}`,
  async run(args, context) {
    const { repo } = config(context, "github");
    const issue = (await github(context, "GET", `/repos/${repo}/issues/${args.number}`)) as unknown as GithubIssue;
    const comments = (await github(
      context,
      "GET",
      `/repos/${repo}/issues/${args.number}/comments?per_page=10`,
    )) as unknown as Array<{ user: { login: string } | null; body: string; created_at: string }>;
    const thread = comments.map((comment) => `— ${comment.user?.login ?? "unknown"} at ${comment.created_at}:\n${comment.body}`);
    return [issueLine(issue), "", issue.body ?? "(no description)", "", `Comments (${comments.length}):`, ...thread].join("\n");
  },
});

const githubComment = define({
  name: "github.comment",
  summary: "Add a comment to an issue or pull request.",
  argsHint: '{"number": number, "body": string}',
  schema: z.object({ number: issueNumber, body: z.string().min(1).max(8000) }),
  effect: "write",
  kind: "github",
  title: (args) => `Comment on GitHub #${args.number} ${quote(args.body)}`,
  async run(args, context) {
    const { repo } = config(context, "github");
    const result = await github(context, "POST", `/repos/${repo}/issues/${args.number}/comments`, { body: args.body });
    return `Comment added: ${String(result.html_url)}`;
  },
});

const githubAddLabels = define({
  name: "github.add_labels",
  summary: "Add labels to an issue or pull request.",
  argsHint: '{"number": number, "labels": string[]}',
  schema: z.object({ number: issueNumber, labels: z.array(z.string().min(1).max(50)).min(1).max(10) }),
  effect: "write",
  kind: "github",
  title: (args) => `Label GitHub #${args.number}: ${args.labels.join(", ")}`,
  async run(args, context) {
    const { repo } = config(context, "github");
    await github(context, "POST", `/repos/${repo}/issues/${args.number}/labels`, { labels: args.labels });
    return "Labels added.";
  },
});

const githubCreateIssue = define({
  name: "github.create_issue",
  summary: "Open a new issue in the linked repository.",
  argsHint: '{"title": string, "body": string}',
  schema: z.object({ title: z.string().min(1).max(250), body: z.string().max(8000).default("") }),
  effect: "write",
  kind: "github",
  title: (args) => `Open GitHub issue ${quote(args.title)}`,
  async run(args, context) {
    const { repo } = config(context, "github");
    const result = await github(context, "POST", `/repos/${repo}/issues`, { title: args.title, body: args.body });
    return `Issue opened: ${String(result.html_url)}`;
  },
});

// ── Generic HTTP API ────────────────────────────────────────────────────────

/** Joins a model-supplied path onto the connection's base URL and refuses anything that escapes it. */
export function resolveApiUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const target = new URL(path.replace(/^\/+/, ""), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    throw new ToolError("That path is outside the connection's base URL.");
  }
  return target.toString();
}

const httpRequest = define({
  name: "http.request",
  summary:
    "Call the user's linked HTTP API. The path is relative to its base URL. Use GET to read; other methods change data.",
  argsHint: '{"method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "path": string, "body"?: object}',
  schema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    path: z.string().max(1500),
    body: z.unknown().optional(),
  }),
  effect: (args) => (args.method === "GET" ? "read" : "write"),
  kind: "http",
  title: (args) => `${args.method} ${args.path}`,
  async run(args, context) {
    const { baseUrl, headerName, headerValue } = config(context, "http");
    const hasBody = args.method !== "GET" && args.body !== undefined;
    const response = await safeFetch(resolveApiUrl(baseUrl!, args.path), {
      method: args.method,
      headers: {
        accept: "application/json, text/plain, */*",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(headerName && headerValue ? { [headerName]: headerValue } : {}),
      },
      body: hasBody ? JSON.stringify(args.body) : undefined,
    });
    return `HTTP ${response.status}\n${response.text}`;
  },
});

// ── Registry ────────────────────────────────────────────────────────────────

const BUILT_IN = [webFetch, memorySave];
const BY_KIND: Record<ConnectionKind, ToolDef[]> = {
  telegram: [telegramSend],
  gmail: [gmailSearch, gmailRead],
  slack: [slackPost],
  discord: [discordPost],
  github: [githubSearch, githubGetIssue, githubComment, githubAddLabels, githubCreateIssue],
  http: [httpRequest],
};

export function toolsFor(kinds: ConnectionKind[]): ToolDef[] {
  return [...BUILT_IN, ...kinds.flatMap((kind) => BY_KIND[kind] ?? [])];
}

export function effectOf(tool: ToolDef, args: Record<string, unknown>): ToolEffect {
  return typeof tool.effect === "function" ? tool.effect(args) : tool.effect;
}

/** Confirms a new connection works before it is saved. Returns an error message, or null when fine. */
export async function testConnection(kind: ConnectionKind, values: Config): Promise<string | null> {
  const context: ToolContext = { configs: { [kind]: values }, saveMemory: async () => {} };
  try {
    switch (kind) {
      case "telegram": {
        if (!/^\d+:[\w-]{20,}$/.test(values.botToken ?? "")) return "That does not look like a Telegram bot token.";
        const response = await safeFetch(`https://api.telegram.org/bot${values.botToken}/getChat?chat_id=${encodeURIComponent(values.chatId ?? "")}`);
        if (response.status === 401 || response.status === 404) return "Telegram did not accept that bot token.";
        if (!response.ok) return "The bot cannot see that chat. Send /start to the bot from the chat, then try again.";
        return null;
      }
      case "slack":
        return /^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(values.webhookUrl ?? "")
          ? null
          : "That does not look like a Slack incoming webhook URL.";
      case "discord": {
        if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/\S+$/.test(values.webhookUrl ?? "")) {
          return "That does not look like a Discord webhook URL.";
        }
        const response = await safeFetch(values.webhookUrl!);
        return response.ok ? null : "Discord did not recognise that webhook.";
      }
      case "github": {
        if (!/^[\w.-]+\/[\w.-]+$/.test(values.repo ?? "")) return "Write the repository as owner/name.";
        await github(context, "GET", `/repos/${values.repo}`);
        return null;
      }
      case "gmail":
        // Linked through Google sign-in, which checks the grant itself.
        return null;
      case "http": {
        const url = new URL(values.baseUrl ?? "");
        if (url.protocol !== "https:") return "The base URL must start with https://.";
        if (Boolean(values.headerName) !== Boolean(values.headerValue)) return "Fill in both the header name and its value, or neither.";
        return null;
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : "The connection test failed.";
  }
}
