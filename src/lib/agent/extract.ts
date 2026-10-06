/** Turns fetched HTML and feeds into compact text a model can read cheaply. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    // Keep absolute link targets, since jobs often need to pass links on.
    .replace(/<a\b[^>]*?href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, " ").trim();
      return text ? `${text} (${href})` : href;
    })
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `Title: ${stripTags(title)}\n\n${text}` : text;
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? unwrapCdata(match[1]!).trim() : undefined;
}

export function isFeed(text: string): boolean {
  const head = text.slice(0, 2000);
  return /<rss\b|<feed\b[^>]*xmlns|<rdf:RDF\b/i.test(head);
}

export function feedToText(xml: string, maxItems = 30): string {
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const lines = items.slice(0, maxItems).map((block, index) => {
    const title = stripTags(tag(block, "title") ?? "(untitled)");
    const link =
      /<link\b[^>]*?href=["']([^"']+)["']/i.exec(block)?.[1] ?? stripTags(tag(block, "link") ?? "") ?? "";
    const date = tag(block, "pubDate") ?? tag(block, "updated") ?? tag(block, "published") ?? tag(block, "dc:date") ?? "";
    const summary = stripTags(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "").slice(0, 280);
    return [`${index + 1}. ${title}`, link && `   ${link}`, date && `   ${date}`, summary && `   ${summary}`]
      .filter(Boolean)
      .join("\n");
  });
  const feedTitle = stripTags(tag(xml.replace(/<(item|entry)\b[\s\S]*/i, ""), "title") ?? "");
  return [`Feed: ${feedTitle || "(untitled)"} — ${items.length} items`, ...lines].join("\n");
}

/** Cuts text to a UTF-8 byte budget without splitting a character. */
export function truncateBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return `${buffer.subarray(0, end).toString("utf8")}\n[…cut]`;
}
