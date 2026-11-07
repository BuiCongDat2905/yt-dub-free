import { browser } from "wxt/browser";

import {
  TTS_PROXY_MESSAGE,
  bytesToBase64,
  isAllowedTtsUrl,
  type TtsProxyReply,
} from "@/lib/tts/proxy";

const TOGGLE_COMMAND = "toggle-dubbing";
const ARM_CAPTURE_MESSAGE = "ytdubfree:arm-capture";

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
    const candidate = message as { type?: string; url?: string } | null;
    if (!candidate?.type) return undefined;

    if (candidate.type === ARM_CAPTURE_MESSAGE) {
      return armCaptionHook(sender.tab?.id);
    }
    if (candidate.type === TTS_PROXY_MESSAGE) {
      return proxyTtsFetch(String(candidate.url ?? ""));
    }
    return undefined;
  });
});
