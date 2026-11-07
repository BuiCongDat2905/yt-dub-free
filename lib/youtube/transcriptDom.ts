import type { Cue } from "../subtitle/types.ts";
import { CaptionUnavailableError } from "../subtitle/types.ts";
import { normalizeCues } from "../subtitle/parse.ts";

const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";
const RENDERER_SELECTOR = "ytd-transcript-renderer";
const SECTION_SELECTOR = "ytd-video-description-transcript-section-renderer";
const TRANSCRIPT_BUTTON_TEXT = /transcript|bản ghi|bảng điểm|bảng ghi|lời thoại|hiện văn bản|字幕/i;
const EXPAND_SELECTOR = [
  "ytd-text-inline-expander #expand",
  "ytd-watch-metadata #expand",
  "tp-yt-paper-button#expand",
  "#description-inline-expander #expand",
  "#expand",
].join(", ");
const SECTION_CLICKABLE_SELECTOR =
  "button, a, [role='button'], yt-button-shape, ytd-button-renderer, yt-touch-feedback-shape, tp-yt-paper-button";

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
  sectionHtml: string[];
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
  const labels: string[] = [];
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("button, a, tp-yt-paper-button"))) {
    const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (label !== "" && TRANSCRIPT_BUTTON_TEXT.test(label)) labels.push(label.slice(0, 60));
    if (labels.length >= 5) break;
  }

  const sectionHtml = Array.from(doc.querySelectorAll(SECTION_SELECTOR))
    .slice(0, 2)
    .map((element) => (element as HTMLElement).outerHTML.replace(/\s+/g, " ").slice(0, 500));

  return {
    lang: doc.documentElement.lang || "(none)",
    hasDescription: doc.querySelector("#description") !== null,
    hasExpander: doc.querySelector("ytd-text-inline-expander") !== null,
    expandCandidates: doc.querySelectorAll(EXPAND_SELECTOR).length,
    transcriptSection: doc.querySelectorAll(SECTION_SELECTOR).length,
    transcriptRenderer: doc.querySelectorAll(RENDERER_SELECTOR).length,
    segments: doc.querySelectorAll(SEGMENT_SELECTOR).length,
    buttonLabels: labels,
    sectionHtml,
  };
}

/** Click "thật": nhiều nút YouTube bỏ qua `.click()` trần. */
function pressElement(element: Element): void {
  const target = element as HTMLElement;
  try {
    target.scrollIntoView({ block: "center" });
  } catch {
    // bỏ qua
  }
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
    const Ctor = type.startsWith("pointer") ? (globalThis.PointerEvent ?? MouseEvent) : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true }));
  }
  target.click();
}

function expandDescription(doc: Document): number {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(EXPAND_SELECTOR));
  for (const candidate of candidates) pressElement(candidate);
  return candidates.length;
}

function clickTranscriptSections(doc: Document): number {
  let clicked = 0;
  for (const section of Array.from(doc.querySelectorAll(SECTION_SELECTOR))) {
    const inner = Array.from(section.querySelectorAll<HTMLElement>(SECTION_CLICKABLE_SELECTOR));
    const target = inner[0] ?? (section as HTMLElement);
    pressElement(target);
    clicked += 1;
    if (clicked >= 2) break;
  }
  return clicked;
}

function findTranscriptButton(doc: Document): HTMLElement | null {
  const selectors = [
    `${SECTION_SELECTOR} button`,
    `${SECTION_SELECTOR} a`,
    `${SECTION_SELECTOR} yt-button-shape button`,
    "yt-button-shape button",
    "button",
  ];
  for (const selector of selectors) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
      const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`;
      if (TRANSCRIPT_BUTTON_TEXT.test(label)) return element;
    }
  }
  return null;
}

function scrollTranscriptPanel(doc: Document): void {
  const container = doc.querySelector<HTMLElement>(
    "#segments-container, ytd-transcript-renderer #content, ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer",
  );
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

async function waitForSegments(doc: Document, timeoutMs: number): Promise<Element[]> {
  const deadline = Date.now() + timeoutMs;
  let scrolled = false;
  while (Date.now() < deadline) {
    const nodes = readSegments(doc);
    if (nodes.length > 0) return nodes;
    const rendererOpen = doc.querySelectorAll(RENDERER_SELECTOR).length > 0;
    if (rendererOpen && !scrolled) {
      scrollTranscriptPanel(doc);
      scrolled = true;
    }
    await sleep(300);
  }
  return [];
}

/** Mở panel transcript; lỗi kèm chẩn đoán DOM (gồm HTML section) để sửa selector. */
export async function readTranscriptFromPage(doc: Document = document, timeoutMs = 25000): Promise<Cue[]> {
  let nodes = readSegments(doc);
  const perAttempt = Math.max(4000, Math.floor(timeoutMs / 3));

  if (nodes.length === 0) {
    expandDescription(doc);
    await sleep(700);
    clickTranscriptSections(doc);
    nodes = await waitForSegments(doc, perAttempt);
  }

  if (nodes.length === 0) {
    const button = findTranscriptButton(doc);
    if (button) {
      pressElement(button);
      nodes = await waitForSegments(doc, perAttempt);
    }
  }

  if (nodes.length === 0) {
    expandDescription(doc);
    clickTranscriptSections(doc);
    const button = findTranscriptButton(doc);
    if (button) pressElement(button);
    nodes = await waitForSegments(doc, perAttempt);
  }

  if (nodes.length === 0) {
    throw new CaptionUnavailableError(
      `không mở được panel transcript ${JSON.stringify(collectPanelDiagnostics(doc))}`,
    );
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
