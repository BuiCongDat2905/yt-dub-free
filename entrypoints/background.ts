import { browser } from "wxt/browser";

import { logEvent } from "@/lib/log";
import { PIPER_DO_MESSAGE, PIPER_SYNTH_MESSAGE } from "@/lib/tts/piper";
import {
  TTS_PROXY_MESSAGE,
  bytesToBase64,
  isAllowedTtsUrl,
  type TtsProxyReply,
} from "@/lib/tts/proxy";

const TOGGLE_COMMAND = "toggle-dubbing";
const ARM_CAPTURE_MESSAGE = "ytdubfree:arm-capture";
const OFFSCREEN_PATH = "offscreen.html";
const OFFSCREEN_READY_MESSAGE = "ytdubfree:piper-ready";

let offscreenReady: Promise<void> | null = null;
let offscreenLoaded = false;
let offscreenLoadedResolve: (() => void) | null = null;

function waitOffscreenLoaded(timeoutMs = 20000): Promise<void> {
  if (offscreenLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      offscreenLoadedResolve = null;
      resolve();
    }, timeoutMs);
    offscreenLoadedResolve = () => {
      clearTimeout(timer);
      offscreenLoadedResolve = null;
      resolve();
    };
  });
}

async function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const hasDocument = await browser.offscreen?.hasDocument?.().catch(() => false);
      if (!hasDocument) {
        await browser.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: ["WORKERS"],
          justification: "Chạy Piper TTS cục bộ (ONNX/WASM)",
        });
      }
      await waitOffscreenLoaded();
    })().catch((error) => {
      offscreenReady = null;
      throw error;
    });
  }
  return offscreenReady;
}

const PIPER_SYNTH_TIMEOUT_MS = 90000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${label} sau ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function synthesizeWithPiper(text: string, voiceId?: string): Promise<unknown> {
  try {
    await ensureOffscreen();
  } catch (error) {
    await logEvent("error", "piper", "không tạo được offscreen", error);
    return { ok: false, error: "không tạo được offscreen" };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const reply = await withTimeout(
        browser.runtime.sendMessage({ type: PIPER_DO_MESSAGE, text, voiceId }) as Promise<unknown>,
        PIPER_SYNTH_TIMEOUT_MS,
        "piper",
      );
      if (reply) return reply;
    } catch (error) {
      if (attempt === 2) {
        await logEvent("error", "piper", "gọi offscreen thất bại", error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, error: "offscreen không phản hồi" };
}

/** Hook chạy trong MAIN world của trang YouTube: bắt URL timedtext mà trang tự gọi. */
function captionHook(): void {
  const scope = window as unknown as {
    __ytdubfreeCaptionHook?: boolean;
    __ytdubfreeHookStats?: { fetch: number; xhr: number; caption: number };
  };
  if (scope.__ytdubfreeCaptionHook) return;
  scope.__ytdubfreeCaptionHook = true;
  const stats = { fetch: 0, xhr: 0, caption: 0 };
  scope.__ytdubfreeHookStats = stats;

  const emit = (url: string): void => {
    stats.caption += 1;
    document.dispatchEvent(new CustomEvent("ytdubfree:caption-url", { detail: url }));
  };

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    try {
      stats.fetch += 1;
      const input = args[0];
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input?.url ?? input);
      if (url.includes("/api/timedtext")) emit(url);
    } catch {
      // bỏ qua lỗi đọc tham số
    }
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    try {
      stats.xhr += 1;
      const value = String(url);
      if (value.includes("/api/timedtext")) emit(value);
    } catch {
      // bỏ qua
    }
    return (originalOpen as (...params: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}

async function armCaptionHook(tabId: number | undefined): Promise<{ ok: boolean }> {
  if (tabId === undefined) return { ok: false };
  try {
    await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: captionHook });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function proxyTtsFetch(url: string): Promise<TtsProxyReply> {
  if (!isAllowedTtsUrl(url)) return { ok: false, status: 0, error: "url không được phép" };
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, status: response.status };
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, status: response.status, base64: bytesToBase64(bytes) };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command !== TOGGLE_COMMAND) return;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs[0];
        if (tab?.id === undefined) return;
        return browser.tabs.sendMessage(tab.id, { type: "ytdubfree:toggle" });
      })
      .catch(() => {
        // tab không có content script (không phải youtube.com) — bỏ qua
      });
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    const candidate = message as { type?: string; url?: string; text?: string; voiceId?: string } | null;
    if (!candidate?.type) return undefined;

    if (candidate.type === ARM_CAPTURE_MESSAGE) {
      return armCaptionHook(sender.tab?.id);
    }
    if (candidate.type === OFFSCREEN_READY_MESSAGE) {
      offscreenLoaded = true;
      offscreenLoadedResolve?.();
      return { ok: true };
    }
    if (candidate.type === TTS_PROXY_MESSAGE) {
      return proxyTtsFetch(String(candidate.url ?? ""));
    }
    if (candidate.type === PIPER_SYNTH_MESSAGE) {
      return synthesizeWithPiper(String(candidate.text ?? ""), candidate.voiceId);
    }
    return undefined;
  });
});
