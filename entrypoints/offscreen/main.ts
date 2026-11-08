import { browser } from "wxt/browser";

import { logEvent } from "@/lib/log";
import { DEFAULT_PIPER_VOICE, PIPER_DO_MESSAGE, PIPER_SYNTH_MESSAGE } from "@/lib/tts/piper";

const originalFetch = globalThis.fetch.bind(globalThis);

const extensionUrl = (path: string): string =>
  (globalThis as unknown as { chrome: { runtime: { getURL(path: string): string } } }).chrome.runtime.getURL(path);

/** Đổi asset CDN mà vits-web gọi sang file đóng gói sẵn trong extension. */
function mapAssetUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "cdnjs.cloudflare.com" && url.pathname.includes("/onnxruntime-web/")) {
      return extensionUrl(`ort/${url.pathname.split("/").pop() ?? ""}`);
    }
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("piper-wasm")) {
      return extensionUrl(`piper/${url.pathname.split("/").pop() ?? ""}`);
    }
  } catch {
    // URL tương đối — giữ nguyên
  }
  return rawUrl;
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  return originalFetch(mapAssetUrl(raw), init);
}) as typeof fetch;

type VitsModule = typeof import("@diffusionstudio/vits-web");
type VoiceId = Parameters<VitsModule["predict"]>[0]["voiceId"];
let vitsModule: VitsModule | null = null;

async function loadVits(): Promise<VitsModule> {
  if (!vitsModule) vitsModule = await import("@diffusionstudio/vits-web");
  return vitsModule;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const candidate = message as { type?: string; text?: string; voiceId?: string } | null;
  if (candidate?.type !== PIPER_DO_MESSAGE) return undefined;

  void (async () => {
    try {
      await logEvent("info", "piper", "bắt đầu synth", { length: candidate.text?.length ?? 0 });
      const vits = await loadVits();
      await logEvent("info", "piper", "đã load module vits");
      const wav = await vits.predict({
        text: candidate.text ?? "",
        voiceId: (candidate.voiceId ?? DEFAULT_PIPER_VOICE) as VoiceId,
      });
      const bytes = new Uint8Array(await wav.arrayBuffer());
      await logEvent("info", "piper", "synth xong", { bytes: bytes.length });
      sendResponse({ ok: true, base64: toBase64(bytes), bytes: bytes.length });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await logEvent("error", "piper", messageText);
      sendResponse({ ok: false, error: messageText });
    }
  })();

  return true;
});

console.info(`[YT Dub Free] offscreen Piper ready (${PIPER_SYNTH_MESSAGE})`);
void browser.runtime.sendMessage({ type: "ytdubfree:piper-ready" }).catch(() => {
  // background có thể đang khởi động; bỏ qua
});
