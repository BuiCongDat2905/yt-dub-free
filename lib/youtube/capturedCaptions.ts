import type { Cue } from "../subtitle/types.ts";
import { parseJson3, parseVtt } from "../subtitle/parse.ts";

const CAPTION_EVENT = "ytdubfree:caption-url";

const capturedUrls = new Map<string, string>();
let armed = false;

function handleCaptionEvent(event: Event): void {
  const url = (event as CustomEvent).detail;
  if (typeof url !== "string") return;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("/api/timedtext")) return;
    const videoId = parsed.searchParams.get("v");
    if (!videoId) return;
    const fmt = parsed.searchParams.get("fmt") ?? "";
    const previous = capturedUrls.get(videoId);
    if (fmt === "json3" || previous === undefined || (fmt === "vtt" && !previous.includes("fmt=json3"))) {
      capturedUrls.set(videoId, url);
    }
  } catch {
    // URL lạ — bỏ qua
  }
}

/** Nghe CustomEvent do hook MAIN world phát ra. Hook tự cài ở document_start. */
export function armCapturedCaptions(): void {
  if (armed) return;
  armed = true;
  document.addEventListener(CAPTION_EVENT, handleCaptionEvent);
}

export function getCapturedCaptionUrl(videoId: string): string | null {
  const fromEvent = capturedUrls.get(videoId);
  if (fromEvent) return fromEvent;
  try {
    return sessionStorage.getItem(`ytdubfree:cap:${videoId}`);
  } catch {
    return null;
  }
}

export interface CapturedCaptions {
  cues: Cue[];
  bytes: number;
  fromFormat: "json3" | "vtt";
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lấy transcript từ URL timedtext mà trang đã gọi (URL có token hợp lệ).
 * Fetch ngay trong content script: cùng origin youtube.com nên không vướng CORS.
 */
export async function fetchCapturedCaptions(
  videoId: string,
  timeoutMs = 6000,
): Promise<CapturedCaptions | null> {
  const deadline = Date.now() + timeoutMs;
  let url = getCapturedCaptionUrl(videoId);
  while (!url && Date.now() < deadline) {
    await sleep(250);
    url = getCapturedCaptionUrl(videoId);
  }
  if (!url) return null;

  let text: string;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim() === "") return null;

  const isJson = text.trimStart().startsWith("{");
  const cues = isJson ? parseJson3(text) : parseVtt(text);
  if (cues.length === 0) return null;

  return { cues, bytes: text.length, fromFormat: isJson ? "json3" : "vtt" };
}

/** Bật CC để trang tự gọi timedtext — nguồn URL cho `fetchCapturedCaptions`. */
export function ensureCaptionsEnabled(doc: Document = document): boolean {
  const button = doc.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) return false;
  if (button.getAttribute("aria-pressed") === "true") return false;
  button.click();
  return true;
}

/**
 * Ép trang gọi lại timedtext: tắt CC rồi bật lại.
 * Cần vì YouTube nhớ trạng thái CC — nếu đã bật sẵn, trang không tải caption lại.
 */
export async function triggerCaptionRequest(doc: Document = document): Promise<void> {
  const button = doc.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) return;
  const wasOn = button.getAttribute("aria-pressed") === "true";
  if (wasOn) {
    button.click();
    await sleep(350);
  }
  button.click();
  await sleep(350);
}
