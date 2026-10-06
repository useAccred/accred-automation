export type ConnectionKind = "telegram" | "gmail" | "slack" | "discord" | "github" | "http";

export interface ConnectionField {
  key: string;
  label: string;
  /** Secret fields are never sent back to the browser. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ConnectionKindInfo {
  kind: ConnectionKind;
  label: string;
  blurb: string;
  /** What the agent can do through this connection, shown to the user. */
  abilities: string[];
  /** Empty for connections made through a sign-in flow instead of pasted values. */
  fields: ConnectionField[];
  oauth?: "google";
}

export const CONNECTION_KINDS: Record<ConnectionKind, ConnectionKindInfo> = {
  telegram: {
    kind: "telegram",
    label: "Telegram",
    blurb: "Get messages in any chat, from the Accred bot or your own bot.",
    abilities: ["Send a message"],
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        secret: true,
        required: true,
        placeholder: "123456789:AA…",
        help: "Create a bot with @BotFather and paste the token it gives you.",
      },
      {
        key: "chatId",
        label: "Chat ID",
        secret: false,
        required: true,
        placeholder: "-1001234567890",
        help: "The chat the bot should write to. Send /start to your bot first, then get your ID from @userinfobot.",
      },
    ],
  },
  gmail: {
    kind: "gmail",
    label: "Gmail",
    blurb: "Let agents search and read your mail. Read-only: they cannot send, delete or change anything.",
    abilities: ["Search your mail", "Read an email"],
    fields: [],
    oauth: "google",
  },
  slack: {
    kind: "slack",
    label: "Slack",
    blurb: "Post messages to one channel.",
    abilities: ["Post a message"],
    fields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        secret: true,
        required: true,
        placeholder: "https://hooks.slack.com/services/…",
        help: "Create an incoming webhook for the channel in your Slack app settings.",
      },
    ],
  },
  discord: {
    kind: "discord",
    label: "Discord",
    blurb: "Post messages to one channel.",
    abilities: ["Post a message"],
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        secret: true,
        required: true,
        placeholder: "https://discord.com/api/webhooks/…",
        help: "Channel settings → Integrations → Webhooks → New webhook.",
      },
    ],
  },
  github: {
    kind: "github",
    label: "GitHub",
    blurb: "Read and triage issues and pull requests.",
    abilities: ["Search issues and pull requests", "Read an issue", "Comment", "Add labels", "Open an issue"],
    fields: [
      {
        key: "token",
        label: "Personal access token",
        secret: true,
        required: true,
        placeholder: "github_pat_…",
        help: "A fine-grained token limited to the repositories you want automated, with Issues read and write.",
      },
      {
        key: "repo",
        label: "Repository",
        secret: false,
        required: true,
        placeholder: "owner/name",
        help: "The agent can only act on this repository.",
      },
    ],
  },
  http: {
    kind: "http",
    label: "HTTP API",
    blurb: "Call any JSON API under one base URL.",
    abilities: ["GET requests", "POST, PUT, PATCH and DELETE requests"],
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        secret: false,
        required: true,
        placeholder: "https://api.example.com/v1",
        help: "The agent can only call paths under this URL.",
      },
      {
        key: "headerName",
        label: "Auth header name",
        secret: false,
        required: false,
        placeholder: "Authorization",
      },
      {
        key: "headerValue",
        label: "Auth header value",
        secret: true,
        required: false,
        placeholder: "Bearer …",
      },
    ],
  },
};

export const CONNECTION_KIND_LIST = Object.values(CONNECTION_KINDS);

export const COMING_SOON = ["Google Calendar", "Notion"];

/** Labels for the non-secret details stored with a connection, in the order they are shown. */
const DETAIL_LABELS: Record<string, string> = {
  chat: "Chat",
  chatId: "Chat ID",
  bot: "Bot",
  email: "Account",
  repo: "Repository",
  baseUrl: "Base URL",
  headerName: "Auth header",
};

/** Turns a connection's stored details into labelled pairs, e.g. Chat ID → 123456789. */
export function connectionDetails(display: Record<string, string>): Array<{ label: string; value: string }> {
  return Object.keys(DETAIL_LABELS)
    .filter((key) => display[key])
    .map((key) => ({ label: DETAIL_LABELS[key]!, value: display[key]! }));
}

export function isConnectionKind(value: string): value is ConnectionKind {
  return value in CONNECTION_KINDS;
}
