import { browser } from "wxt/browser";

import {
  TTS_PROXY_MESSAGE,
  bytesToBase64,
  isAllowedTtsUrl,
  type TtsProxyReply,
} from "@/lib/tts/proxy";

const TOGGLE_COMMAND = "toggle-dubbing";

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

  browser.runtime.onMessage.addListener((message) => {
    const candidate = message as { type?: string; url?: string } | null;
    if (candidate?.type !== TTS_PROXY_MESSAGE) return undefined;
    return proxyTtsFetch(String(candidate.url ?? ""));
  });
});
