import type { Message, Model } from "accred";
import { describe, expect, it } from "vitest";
import { messageText } from "../connections/gmail";
import { formatCredits, microToExact, toMicro } from "../credits";
import { describeCron, validateCron } from "../schedule";
import { feedToText, htmlToText, truncateBytes } from "./extract";
import { extractJsonObject, parseReply } from "./protocol";
import { pickRouting, usableTextModels, worstCaseMicro } from "./router";
import { compact } from "./runner";
import { isBlockedAddress, safeFetch } from "./safe-fetch";
import { resolveApiUrl } from "./tools";

function model(id: string, input: string, output: string, extra: Partial<Model> = {}): Model {
  return {
    provider: "test",
    id,
    name: id,
    inputCostUsdPerMillion: input,
    outputCostUsdPerMillion: output,
    cachedInputCostUsdPerMillion: null,
    cacheWrite5mCostUsdPerMillion: null,
    cacheWrite1hCostUsdPerMillion: null,
    cacheReadCostUsdPerMillion: null,
    capabilities: ["text-generation"],
    available: true,
    unavailableReason: null,
    maxInputTokens: 400000,
    maxOutputTokens: 8192,
    pricingSource: null,
    pricingVerifiedAt: null,
    pricingExpiresAt: null,
    pricingType: null,
    ...extra,
  };
}

describe("parseReply", () => {
  it("reads a tool call", () => {
    const result = parseReply('{"thought":"look","tool":"web.fetch","args":{"url":"https://a.example"}}');
    expect(result).toEqual({ ok: true, reply: { type: "tool", thought: "look", tool: "web.fetch", args: { url: "https://a.example" } } });
  });

  it("reads a final answer wrapped in prose and a code fence", () => {
    const result = parseReply('Sure!\n```json\n{"thought":"done","final":"Sent {1} message with a } brace"}\n```');
    expect(result.ok && result.reply).toEqual({ type: "final", thought: "done", final: "Sent {1} message with a } brace" });
  });

  it("rejects replies that are neither, both, or not JSON", () => {
    expect(parseReply("I will fetch the page now.").ok).toBe(false);
    expect(parseReply('{"thought":"hm"}').ok).toBe(false);
    expect(parseReply('{"tool":"a","final":"b"}').ok).toBe(false);
    expect(parseReply('{"tool": 5}').ok).toBe(false);
    expect(parseReply('{"tool":"a", "args": ').ok).toBe(false);
  });

  it("finds the first balanced object", () => {
    expect(extractJsonObject('x {"a":{"b":"}"}} y {"c":1}')).toBe('{"a":{"b":"}"}}');
    expect(extractJsonObject('{"a":"\\"}"}')).toBe('{"a":"\\"}"}');
  });
});

describe("credits", () => {
  it("converts exactly and rounds sub-microcredit amounts up", () => {
    expect(toMicro("0.004213")).toBe(4213n);
    expect(toMicro("12")).toBe(12_000_000n);
    expect(toMicro("0.0000001")).toBe(1n);
    expect(microToExact(4213n)).toBe("0.004213");
    expect(microToExact(12_000_000n)).toBe("12");
    expect(() => toMicro("-1")).toThrow();
  });

  it("formats for display", () => {
    expect(formatCredits(0n)).toBe("0.00");
    expect(formatCredits(4213n)).toBe("0.0042");
    expect(formatCredits(1_234_567_890n)).toBe("1,234.57");
  });
});

describe("routing", () => {
  const catalog = [
    model("claude-sonnet-5", "2", "10"),
    model("claude-haiku-4-5", "1", "5"),
    model("claude-opus-5", "5", "25"),
    model("anthropic/claude-sonnet-5:batch", "1", "5"),
    model("google/gemini-3-pro-image", "2", "12"),
    model("offline", "1", "1", { available: false }),
    model("unpriced", "1", "1", { outputCostUsdPerMillion: null }),
  ];

  it("drops batch, image, unavailable and unpriced models", () => {
    expect(usableTextModels(catalog).map((entry) => entry.id)).toEqual(["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"]);
  });

  it("picks tiers per mode", () => {
    expect(pickRouting(catalog, "auto")).toMatchObject({ planner: { id: "claude-sonnet-5" }, reader: { id: "claude-haiku-4-5" } });
    expect(pickRouting(catalog, "economy")).toMatchObject({ planner: { id: "claude-haiku-4-5" }, reader: { id: "claude-haiku-4-5" } });
    expect(pickRouting(catalog, "quality")).toMatchObject({ planner: { id: "claude-opus-5" }, reader: { id: "claude-sonnet-5" } });
    expect(pickRouting(catalog, "pinned", "claude-opus-5").planner.id).toBe("claude-opus-5");
    expect(() => pickRouting(catalog, "pinned", "nope")).toThrow();
    expect(pickRouting(catalog, "pinned", "claude-opus-5", "claude-haiku-4-5")).toMatchObject({
      planner: { id: "claude-opus-5" },
      reader: { id: "claude-haiku-4-5" },
    });
    // A reader that is no longer listed falls back to the brain model.
    expect(pickRouting(catalog, "pinned", "claude-opus-5", "gone").reader.id).toBe("claude-opus-5");
  });

  it("falls back to price when no known model is listed", () => {
    const unknown = [model("vendor/big", "3", "12"), model("vendor/small", "0.2", "1.2"), model("vendor/huge", "8", "30")];
    expect(pickRouting(unknown, "auto")).toMatchObject({ planner: { id: "vendor/big" }, reader: { id: "vendor/small" } });
    expect(pickRouting(unknown, "quality").planner.id).toBe("vendor/huge");
  });

  it("prices the worst case of a call", () => {
    // 3,000 chars is about 1,016 tokens in, 1,000 out at $2 / $10 per million: $0.012032 = 1.2032 credits.
    expect(worstCaseMicro(catalog[0]!, 3000, 1000)).toBe(1_203_200n);
  });
});

describe("outbound requests", () => {
  it("blocks private, loopback and metadata addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "172.20.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses local URLs before connecting", async () => {
    for (const url of ["http://127.0.0.1:5432/", "http://localhost/", "http://[::1]/", "file:///etc/passwd", "http://user:pw@example.com/", "http://169.254.169.254/latest/meta-data"]) {
      await expect(safeFetch(url), url).rejects.toThrow();
    }
  });

  it("keeps API paths under the base URL", () => {
    expect(resolveApiUrl("https://api.example.com/v1", "/users?id=1")).toBe("https://api.example.com/v1/users?id=1");
    expect(resolveApiUrl("https://api.example.com/v1/", "users")).toBe("https://api.example.com/v1/users");
    expect(() => resolveApiUrl("https://api.example.com/v1", "../admin")).toThrow();
    expect(() => resolveApiUrl("https://api.example.com/v1", "https://evil.example/x")).toThrow();
    expect(() => resolveApiUrl("https://api.example.com/v1", "//evil.example/x")).not.toThrow();
    expect(resolveApiUrl("https://api.example.com/v1", "//evil.example/x")).toBe("https://api.example.com/v1/evil.example/x");
  });
});

describe("schedule", () => {
  it("accepts sane schedules and rejects too-frequent ones", () => {
    expect(validateCron("0 8 * * *", "Europe/Berlin")).toBeNull();
    expect(validateCron("*/15 * * * *", "UTC")).toBeNull();
    expect(validateCron("* * * * *", "UTC")).toMatch(/5 minutes/);
    expect(validateCron("0,1 * * * *", "UTC")).toMatch(/5 minutes/);
    expect(validateCron("nonsense", "UTC")).not.toBeNull();
    expect(validateCron("0 0 8 * * *", "UTC")).not.toBeNull();
  });

  it("describes the common shapes", () => {
    expect(describeCron("0 8 * * *")).toBe("Every day at 08:00");
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
    expect(describeCron("30 9 * * 1")).toBe("Mondays at 09:30");
    expect(describeCron("0 9 * * 1-5")).toBe("Cron 0 9 * * 1-5");
  });
});

describe("text extraction", () => {
  it("turns HTML into readable text and keeps links", () => {
    const text = htmlToText('<html><head><title>T &amp; C</title><style>x{}</style></head><body><h1>Hi</h1><script>bad()</script><p>See <a href="https://a.example/x">this</a>.</p></body></html>');
    expect(text).toBe("Title: T & C\n\nHi\nSee this (https://a.example/x).");
  });

  it("lists feed items", () => {
    const text = feedToText('<rss><channel><title>News</title><item><title><![CDATA[One]]></title><link>https://a.example/1</link><description>&lt;p&gt;Body&lt;/p&gt;</description></item></channel></rss>');
    expect(text).toContain("Feed: News — 1 items");
    expect(text).toContain("1. One\n   https://a.example/1");
  });

  it("cuts on a character boundary", () => {
    expect(truncateBytes("héllo", 2)).toBe("h\n[…cut]");
    expect(truncateBytes("short", 100)).toBe("short");
  });
});

describe("compact", () => {
  it("drops the oldest tool results first and keeps the newest", () => {
    const result = (label: string) => ({ role: "user", content: `<tool_result tool="web.fetch" status="ok">\n${label.repeat(4000)}\n</tool_result>` }) as Message;
    const messages: Message[] = [
      { role: "system", content: "system" },
      { role: "user", content: "JOB: test" },
      result("a"),
      { role: "assistant", content: "{}" },
      result("b"),
      { role: "assistant", content: "{}" },
      result("c"),
    ];
    compact(messages, 5000);
    expect(messages[2]!.content).toContain("Earlier result removed");
    expect(messages[4]!.content).toContain("Earlier result removed");
    expect(messages[6]!.content).toContain("cccc");
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeLessThanOrEqual(5000);
  });
});

describe("gmail message text", () => {
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

  it("prefers the plain-text part and ignores attachments", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("attachment text") } },
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/html", body: { data: b64("<p>Hello <b>there</b></p>") } },
            { mimeType: "text/plain", body: { data: b64("Hello there\n") } },
          ],
        },
      ],
    };
    expect(messageText(payload)).toBe("Hello there");
  });

  it("falls back to HTML as text, and to nothing when there is no body", () => {
    expect(messageText({ mimeType: "text/html", body: { data: b64("<p>Invoice due <a href=\"https://pay.example/1\">here</a></p>") } })).toBe(
      "Invoice due here (https://pay.example/1)",
    );
    expect(messageText({ mimeType: "multipart/mixed", parts: [] })).toBe("");
    expect(messageText(undefined)).toBe("");
  });
});
