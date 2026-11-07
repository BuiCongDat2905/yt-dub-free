import type { Cue } from "../subtitle/types.ts";
import { CaptionUnavailableError } from "../subtitle/types.ts";
import { normalizeCues } from "../subtitle/parse.ts";

const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";
const TRANSCRIPT_BUTTON_TEXT = /transcript|bản ghi|bảng điểm|bảng ghi|lời thoại|字幕/i;
const EXPAND_SELECTORS = [
  "ytd-text-inline-expander #expand",
  "ytd-watch-metadata #expand",
  "tp-yt-paper-button#expand",
  "#description-inline-expander #expand",
  "#expand-button",
  "#expand",
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PanelDiagnostics {
  lang: string;
  hasDescription: boolean;
  hasExpander: boolean;
  expandCandidates: number;
  transcriptSection: number;
  transcriptRenderer: number;
  segments: number;
  buttonLabels: string[];
}

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

export function collectPanelDiagnostics(doc: Document = document): PanelDiagnostics {
  const buttons = Array.from(
    doc.querySelectorAll<HTMLElement>("button, yt-button-shape button, a, tp-yt-paper-button"),
  );
  const labels: string[] = [];
  for (const element of buttons) {
    const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (label !== "" && TRANSCRIPT_BUTTON_TEXT.test(label)) labels.push(label.slice(0, 60));
    if (labels.length >= 5) break;
  }

  return {
    lang: doc.documentElement.lang || "(none)",
    hasDescription: doc.querySelector("#description") !== null,
    hasExpander: doc.querySelector("ytd-text-inline-expander") !== null,
    expandCandidates: doc.querySelectorAll(EXPAND_SELECTORS.join(", ")).length,
    transcriptSection: doc.querySelectorAll("ytd-video-description-transcript-section-renderer").length,
    transcriptRenderer: doc.querySelectorAll("ytd-transcript-renderer").length,
    segments: doc.querySelectorAll(SEGMENT_SELECTOR).length,
    buttonLabels: labels,
  };
}

/** Click "thật": nhiều nút YouTube bỏ qua `.click()` trần. */
function pressElement(element: Element): void {
  const target = element as HTMLElement;
  try {
    target.scrollIntoView({ block: "center" });
  } catch {
    // bỏ qua nếu môi trường không hỗ trợ
  }
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
    const Ctor = type.startsWith("pointer") ? (globalThis.PointerEvent ?? MouseEvent) : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true }));
  }
  try {
    target.click();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  } catch {
    // bỏ qua
  }
}

function expandDescription(doc: Document): void {
  const expander = doc.querySelector("ytd-text-inline-expander");
  const candidate = doc.querySelector<HTMLElement>(EXPAND_SELECTORS.join(", "));
  if (candidate) pressElement(candidate);
  else if (expander) pressElement(expander);
}

function findTranscriptButton(doc: Document): HTMLElement | null {
  for (const label of [
    "ytd-video-description-transcript-section-renderer button",
    "ytd-video-description-transcript-section-renderer yt-button-shape button",
    "ytd-video-description-transcript-section-renderer a",
    "button[aria-label]",
    "yt-button-shape button",
    "button",
    "a",
  ]) {
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>(label));
    for (const element of candidates) {
      const text = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`;
      if (TRANSCRIPT_BUTTON_TEXT.test(text)) return element;
    }
  }
  return null;
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

/** Đọc transcript từ panel giao diện; lỗi kèm chẩn đoán DOM để sửa selector. */
export async function readTranscriptFromPage(doc: Document = document, timeoutMs = 12000): Promise<Cue[]> {
  let nodes = readSegments(doc);

  if (nodes.length === 0) {
    for (let attempt = 0; attempt < 3 && nodes.length === 0; attempt += 1) {
      expandDescription(doc);
      await sleep(800);
      const button = findTranscriptButton(doc);
      if (button) pressElement(button);
      nodes = await waitForSegments(doc, Math.max(3000, Math.floor(timeoutMs / 3)));
    }
  }

  if (nodes.length === 0) {
    const diagnostics = collectPanelDiagnostics(doc);
    throw new CaptionUnavailableError(`không mở được panel transcript ${JSON.stringify(diagnostics)}`);
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
