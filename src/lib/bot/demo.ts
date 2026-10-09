import type { BotColor, BotShape } from "../db/schema";

/**
 * The scripted workspace on the landing page. Every line is an example of
 * what a bot does, not live data.
 */
export interface DemoBot {
  id: string;
  name: string;
  color: BotColor;
  shape: BotShape;
  crew?: Array<{ color: BotColor; shape: BotShape }>;
  time: string;
  preview: string;
  thread: DemoLine[];
}

export type DemoLine =
  | { t: "time"; label: string }
  | { t: "user"; text: string }
  | { t: "bot"; text: string }
  | { t: "event"; icon?: "clock" | "check" | "memory"; text: string };

export const DEMO_PERSON = { initials: "AS", name: "Asha Sethi" };

export const DEMO_BOTS: DemoBot[] = [
  {
    id: "chief",
    name: "Chief",
    color: "teal",
    shape: "round",
    time: "Yesterday",
    preview: "booked the room and sent the calendar holds around.",
    thread: [
      { t: "time", label: "Yesterday 09:12" },
      { t: "user", text: "offsite is the 24th. get a room near the office and hold everyone's calendars" },
      { t: "bot", text: "on it. three rooms fit twelve people within a ten-minute walk. the one at harbour house has the best light and costs $640 for the day. want that one?" },
      { t: "user", text: "yes" },
      { t: "event", icon: "check", text: "Confirmed · Book Harbour House, 24 Oct" },
      { t: "event", icon: "memory", text: "Saved to memory · Offsite: 24 Oct, Harbour House, 12 people" },
      { t: "bot", text: "booked the room and sent the calendar holds around. **11 of 12** accepted, mia is out that day. i'll chase her tomorrow morning." },
    ],
  },
  {
    id: "sales",
    name: "Sales Outbound",
    color: "orange",
    shape: "drop",
    time: "18:43",
    preview: "Done.",
    thread: [
      { t: "time", label: "18:40" },
      { t: "user", text: "overnight batch: 30 logistics companies with 20 to 200 people, drafts in my voice" },
      { t: "bot", text: "i'll research each one from their site and news, score fit, and park every draft for your ok. nothing goes out without you." },
      { t: "event", icon: "clock", text: "Created routine · Overnight outbound" },
      { t: "time", label: "18:43" },
      { t: "bot", text: "✓ Researched → 30 accounts, 4 skipped as poor fit\n✓ Drafted → 26 emails, 26 LinkedIn notes\n✓ Review list → ready in your inbox manager" },
      { t: "user", text: "ty" },
      { t: "bot", text: "Done." },
    ],
  },
  {
    id: "inbox",
    name: "Inbox Manager",
    color: "indigo",
    shape: "peak",
    time: "15:44",
    preview: "sent. inbox at zero, 5 drafts parked for tomorrow.",
    thread: [
      { t: "time", label: "15:30" },
      { t: "user", text: "clear my inbox, reply to anything simple, park the rest" },
      { t: "bot", text: "42 unread. 19 are notices i'll archive, 14 are simple replies i can draft now, 9 need you. i'll show you the 14 before anything goes." },
      { t: "event", icon: "check", text: "Confirmed · Send 14 replies" },
      { t: "time", label: "15:44" },
      { t: "bot", text: "sent. inbox at zero, **5 drafts** parked for tomorrow. the 9 that need you are starred, the investor one first." },
    ],
  },
  {
    id: "account",
    name: "Account Manager",
    color: "violet",
    shape: "round",
    time: "13:44",
    preview: "invite's out to vikram. globex note held in drafts.",
    thread: [
      { t: "time", label: "13:20" },
      { t: "user", text: "globex renewal is in 3 weeks. set up the call and draft the note" },
      { t: "bot", text: "globex replied on pricing last quarter, same thread. they only sign annual and vikram is the one who approves. i'll propose tuesday or thursday afternoon." },
      { t: "event", icon: "memory", text: "Updated memory · Globex: annual only, Vikram approves" },
      { t: "time", label: "13:44" },
      { t: "bot", text: "invite's out to vikram. globex note held in drafts, two paragraphs, leads with the usage numbers." },
    ],
  },
  {
    id: "talent",
    name: "Talent Scout",
    color: "blue",
    shape: "drop",
    time: "10:44",
    preview: "3 intros drafted in your voice, held for your ok.",
    thread: [
      { t: "time", label: "10:30" },
      { t: "user", text: "senior backend role. screen the 40 applicants against the post" },
      { t: "bot", text: "✓ Screened → 40 profiles\n✓ Strong → 3, all with payments experience\n✓ Maybe → 6, worth a short call" },
      { t: "time", label: "10:44" },
      { t: "bot", text: "3 intros drafted in your voice, held for your ok. the first one shipped a ledger at a bank, she's the one to call first." },
    ],
  },
  {
    id: "expense",
    name: "Expense Manager",
    color: "orange",
    shape: "round",
    time: "14:44",
    preview: "report filed. 9 receipts, nothing outstanding.",
    thread: [
      { t: "time", label: "Yesterday 18:44" },
      { t: "user", text: "month-end is friday, close out the card for me?" },
      { t: "bot", text: "i'll match every charge to a receipt and file the report. anything that doesn't line up, i ask instead of guessing." },
      { t: "event", icon: "clock", text: "Created routine · Month-end close" },
      { t: "time", label: "13:44" },
      { t: "bot", text: "✓ Receipts → 9 matched to card charges\n✓ Report → drafted · $2,340 across 3 trips\n✓ Flagged → 1 charge · harbor hotel, $412 twice" },
      { t: "bot", text: "the harbor hotel charged $412 on the 12th and again on the 14th. double-billed, or two separate nights?" },
      { t: "time", label: "14:44" },
      { t: "user", text: "two nights, mia stayed the second one" },
      { t: "bot", text: "that clears it. report filed: **9 receipts** matched, $2,340 across 3 trips, nothing outstanding." },
    ],
  },
  {
    id: "crew",
    name: "Launch crew",
    color: "teal",
    shape: "round",
    crew: [
      { color: "teal", shape: "round" },
      { color: "violet", shape: "round" },
      { color: "indigo", shape: "peak" },
    ],
    time: "12:44",
    preview: "that leaves the pipeline. i'd spin up a dedicated bot.",
    thread: [
      { t: "time", label: "12:30" },
      { t: "user", text: "launch is thursday. who's doing what?" },
      { t: "bot", text: "chief here. account manager has the customer emails, inbox manager holds the press replies, research has the comparison page. that leaves the pipeline. i'd spin up a dedicated bot." },
    ],
  },
];
