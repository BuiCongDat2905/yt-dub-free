export interface HookStats {
  fetch: number;
  xhr: number;
  caption: number;
}

/**
 * Chạy trong MAIN world tại document_start, trước script của YouTube.
 * Mục đích: bắt URL `/api/timedtext` mà chính trang tạo ra (có token hợp lệ),
 * rồi chuyển sang content script qua CustomEvent.
 */
export function installCaptionHook(): void {
  const scope = window as unknown as {
    __ytdubfreeCaptionHook?: boolean;
    __ytdubfreeHookStats?: HookStats;
  };
  if (scope.__ytdubfreeCaptionHook) return;
  scope.__ytdubfreeCaptionHook = true;
  const stats: HookStats = { fetch: 0, xhr: 0, caption: 0 };
  scope.__ytdubfreeHookStats = stats;

  const emit = (url: string): void => {
    stats.caption += 1;
    try {
      const parsed = new URL(url, location.href);
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        sessionStorage.setItem(`ytdubfree:cap:${videoId}`, url);
        sessionStorage.setItem("ytdubfree:cap:last", url);
      }
    } catch {
      // bỏ qua lỗi lưu URL
    }
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
