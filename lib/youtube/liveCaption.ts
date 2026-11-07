import type { Cue } from "../subtitle/types.ts";

export interface CaptionLine {
  text: string;
  start: number;
  end: number;
}

export function normalizeCaptionText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Gom caption đang chạy trên player thành từng dòng hoàn chỉnh.
 * Caption YouTube hiện dần theo từng chữ, nên phải đợi dòng ổn định rồi mới chốt.
 */
export class CaptionLineTracker {
  private buffer = "";
  private startAt = 0;

  push(rawText: string, at: number): CaptionLine[] {
    const text = normalizeCaptionText(rawText);
    if (text === "") return this.flush(at);
    if (this.buffer === "") {
      this.buffer = text;
      this.startAt = at;
      return [];
    }
    if (text === this.buffer) return [];
    if (text.startsWith(this.buffer)) {
      this.buffer = text;
      return [];
    }
    if (this.buffer.startsWith(text)) return [];

    const emitted = this.emit(at);
    this.buffer = text;
    this.startAt = at;
    return emitted;
  }

  flush(at: number): CaptionLine[] {
    return this.emit(at);
  }

  get current(): string {
    return this.buffer;
  }

  private emit(at: number): CaptionLine[] {
    if (this.buffer === "") return [];
    const line: CaptionLine = {
      text: this.buffer,
      start: this.startAt,
      end: Math.max(this.startAt + 0.8, at),
    };
    this.buffer = "";
    return [line];
  }
}

export function readCaptionText(doc: Document = document): string {
  const segments = Array.from(doc.querySelectorAll<HTMLElement>(".ytp-caption-segment"));
  return segments.map((segment) => segment.textContent ?? "").join(" ");
}

export interface LiveCaptionHandle {
  stop(): void;
  enabledCc: boolean;
}

/**
 * Đọc phụ đề ngay trên player (không cần API/panel). Bật CC nếu chưa bật.
 * Chỉ dùng được trong content script — cần DOM của trang YouTube.
 */
export function startLiveCaptions(
  video: HTMLVideoElement,
  onLine: (line: CaptionLine) => void,
  doc: Document = document,
): LiveCaptionHandle {
  const button = doc.querySelector<HTMLElement>(".ytp-subtitles-button");
  let enabledCc = false;
  if (button && button.getAttribute("aria-pressed") !== "true") {
    button.click();
    enabledCc = true;
  }

  const player = video.closest("#movie_player") ?? doc.body;
  const tracker = new CaptionLineTracker();
  let emitTimer: number | null = null;
  let stopped = false;

  const emit = (at: number): void => {
    for (const line of tracker.flush(at)) onLine(line);
  };

  const handle = (): void => {
    if (stopped) return;
    const lines = tracker.push(readCaptionText(doc), video.currentTime);
    for (const line of lines) onLine(line);
  };

  const scheduleEmit = (): void => {
    if (emitTimer !== null) window.clearTimeout(emitTimer);
    emitTimer = window.setTimeout(() => {
      emitTimer = null;
      handle();
    }, 120);
  };

  const observer = new MutationObserver(scheduleEmit);
  observer.observe(player, { subtree: true, childList: true, characterData: true });
  handle();

  return {
    enabledCc,
    stop(): void {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      if (emitTimer !== null) window.clearTimeout(emitTimer);
      emit(video.currentTime);
      if (enabledCc && button) button.click();
    },
  };
}

export function cuesFromLines(lines: CaptionLine[], lagSeconds: number): Cue[] {
  return lines.map((line) => ({
    start: Math.max(0, line.start + lagSeconds),
    end: Math.max(line.start + lagSeconds + 0.5, line.end + lagSeconds),
    text: line.text,
  }));
}
