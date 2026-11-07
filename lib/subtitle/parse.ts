import type { Cue } from "./types.ts";

const TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
  aAppend?: number;
}

export function decodeEntities(input: string): string {
  return input.replace(/&[a-z#0-9]+;/gi, (match) => ENTITIES[match] ?? match);
}

export function cleanText(input: string): string {
  return decodeEntities(input.replace(TAG, "")).replace(WHITESPACE, " ").trim();
}

/** Sắp xếp, bỏ cue rỗng, bảo đảm end > start và không chồng lấn. */
export function normalizeCues(cues: Cue[]): Cue[] {
  const sorted = cues
    .map((cue) => ({
      start: Math.max(0, Number.isFinite(cue.start) ? cue.start : 0),
      end: Number.isFinite(cue.end) ? cue.end : 0,
      text: cue.text.trim(),
    }))
    .filter((cue) => cue.text.length > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Cue[] = [];
  for (const cue of sorted) {
    const previous = out[out.length - 1];
    if (previous && cue.start < previous.end) {
      previous.end = Math.max(previous.start + 0.05, cue.start);
    }
    const end = cue.end > cue.start ? cue.end : cue.start + 0.05;
    out.push({ start: cue.start, end, text: cue.text });
  }
  return out;
}

export function parseJson3(raw: string): Cue[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = (data as { events?: Json3Event[] } | null)?.events;
  if (!Array.isArray(events)) return [];

  const cues: Cue[] = [];
  for (const event of events) {
    if (event?.aAppend === 1 || !event?.segs?.length) continue;
    const text = cleanText(event.segs.map((seg) => seg.utf8 ?? "").join(""));
    if (!text) continue;
    const startMs = event.tStartMs ?? 0;
    const durationMs = event.dDurationMs ?? 0;
    cues.push({ start: startMs / 1000, end: (startMs + Math.max(durationMs, 50)) / 1000, text });
  }
  return normalizeCues(cues);
}

const TIMESTAMP = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{3})`;
const TIMING_LINE = new RegExp(
  String.raw`^\s*${TIMESTAMP}\s*-->\s*${TIMESTAMP}(?:\s+\S.*)?$`,
);

function toSeconds(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
  return (
    (hours ? Number(hours) * 3600 : 0) +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis) / 1000
  );
}

export function parseVtt(raw: string): Cue[] {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: Cue[] = [];
  let index = 0;

  while (index < lines.length) {
    const match = TIMING_LINE.exec(lines[index] ?? "");
    if (!match) {
      index += 1;
      continue;
    }
    const start = toSeconds(match[1], match[2] ?? "0", match[3] ?? "0", match[4] ?? "0");
    const end = toSeconds(match[5], match[6] ?? "0", match[7] ?? "0", match[8] ?? "0");
    index += 1;

    const textLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (line.trim() === "" || TIMING_LINE.test(line)) break;
      textLines.push(line);
      index += 1;
    }
    const text = cleanText(textLines.join(" "));
    if (text) cues.push({ start, end, text });
  }
  return normalizeCues(cues);
}
