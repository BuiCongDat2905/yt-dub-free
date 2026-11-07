import type { Cue } from "../subtitle/types.ts";
import { CaptionUnavailableError } from "../subtitle/types.ts";
import { normalizeCues } from "../subtitle/parse.ts";

const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";
const TRANSCRIPT_BUTTON_SELECTOR = [
  "ytd-video-description-transcript-section-renderer button",
  "ytd-video-description-transcript-section-renderer yt-button-shape button",
  "ytd-video-description-transcript-section-renderer a",
].join(", ");
const EXPAND_SELECTOR = "tp-yt-paper-button#expand, ytd-text-inline-expander#expand, #expand";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseTimestamp(text: string): number {
  const parts = text
    .trim()
    .split(":")
    .map((part) => Number(part.replace(/\D/g, "")));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function readSegments(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(SEGMENT_SELECTOR));
}

async function waitForSegments(doc: Document, timeoutMs: number): Promise<Element[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = readSegments(doc);
    if (nodes.length > 0) return nodes;
    await sleep(300);
  }
  return [];
}

function clickTranscriptButton(doc: Document): boolean {
  const candidates = Array.from(doc.querySelectorAll(TRANSCRIPT_BUTTON_SELECTOR)) as HTMLElement[];
  const button = candidates.find((element) => /transcript|bảng điểm|bảng ghi|phụ đề/i.test(element.textContent ?? ""));
  if (!button) return false;
  button.scrollIntoView({ block: "center" });
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
}

/** Đọc transcript từ panel của YouTube. Chỉ chạy được trong content script. */
export async function readTranscriptFromPage(doc: Document = document, timeoutMs = 20000): Promise<Cue[]> {
  let nodes = readSegments(doc);

  if (nodes.length === 0) {
    const expand = doc.querySelector(EXPAND_SELECTOR) as HTMLElement | null;
    expand?.click();
    await sleep(600);

    if (!clickTranscriptButton(doc)) {
      const expandAgain = doc.querySelector(EXPAND_SELECTOR) as HTMLElement | null;
      expandAgain?.click();
      await sleep(600);
      clickTranscriptButton(doc);
    }
    nodes = await waitForSegments(doc, timeoutMs);
  }

  if (nodes.length === 0) {
    throw new CaptionUnavailableError("video không có panel transcript để đọc");
  }

  const segments = nodes
    .map((node) => ({
      start: parseTimestamp(node.querySelector(".segment-timestamp")?.textContent ?? ""),
      text: (node.querySelector(".segment-text")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) throw new CaptionUnavailableError("panel transcript rỗng");

  const cues: Cue[] = segments.map((segment, index) => {
    const nextStart = segments[index + 1]?.start ?? segment.start + 2;
    return { start: segment.start, end: Math.max(segment.start + 0.3, nextStart), text: segment.text };
  });

  return normalizeCues(cues);
}
