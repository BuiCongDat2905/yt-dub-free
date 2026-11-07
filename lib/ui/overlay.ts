const OVERLAY_ID = "ytdubfree-overlay";
const STYLE_TEXT = `
  position: absolute;
  left: 50%;
  bottom: 12%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font: 600 18px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  user-select: none;
  z-index: 60;
  display: none;
  white-space: pre-wrap;
`;

/** Phụ đề tiếng Việt đè lên player, không chặn chuột và không che control bar. */
export class SubtitleOverlay {
  private element: HTMLDivElement | null = null;
  private container: HTMLElement | null = null;

  attach(video: HTMLVideoElement): void {
    const container =
      (video.closest(".html5-video-container") as HTMLElement | null) ??
      (video.parentElement as HTMLElement | null);
    if (!container) return;
    if (this.element && this.container === container) return;

    this.destroy();
    this.container = container;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const element = document.createElement("div");
    element.id = OVERLAY_ID;
    element.style.cssText = STYLE_TEXT;
    container.appendChild(element);
    this.element = element;
  }

  setText(text: string): void {
    if (!this.element) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      this.element.style.display = "none";
      this.element.textContent = "";
      return;
    }
    this.element.textContent = trimmed;
    this.element.style.display = "block";
  }

  clear(): void {
    this.setText("");
  }

  destroy(): void {
    this.element?.remove();
    this.element = null;
    this.container = null;
  }
}
