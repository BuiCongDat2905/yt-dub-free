import type { Cue } from "../subtitle/types.ts";

export interface CaptionLine {
  text: string;
  start: number;
  end: number;
}

export interface TrackerOptions {
  /** Gộp tối đa bao nhiêu ký tự trước khi buộc phát. */
  maxChars?: number;
  /** Gộp tối đa bao nhiêu giây trước khi buộc phát. */
  maxSeconds?: number;
}

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*$/;

export function normalizeCaptionText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Gom caption đang chạy trên player thành câu hoàn chỉnh.
 * Caption YouTube hiện dần từng chữ và cuộn nhiều dòng, nên phải:
 * 1. chốt "dòng" khi nội dung đổi,
 * 2. gộp các dòng thành câu, chỉ phát khi hết câu hoặc vượt ngưỡng.
 */
export class CaptionLineTracker {
  private buffer = "";
  private startAt = 0;
  private sentence = "";
  private sentenceStart = 0;
  private readonly maxChars: number;
  private readonly maxSeconds: number;

  constructor(options: TrackerOptions = {}) {
    this.maxChars = Math.max(40, options.maxChars ?? 140);
    this.maxSeconds = Math.max(2, options.maxSeconds ?? 8);
  }

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

    const line: CaptionLine = {
      text: this.buffer,
      start: this.startAt,
      end: Math.max(this.startAt + 0.6, at),
    };
    this.buffer = text;
    this.startAt = at;
    return this.addLine(line);
  }

  flush(at: number): CaptionLine[] {
    const emitted: CaptionLine[] = [];
    if (this.buffer !== "") {
      emitted.push(...this.addLine({ text: this.buffer, start: this.startAt, end: Math.max(this.startAt + 0.6, at) }));
      this.buffer = "";
    }
    const sentence = this.takeSentence(at);
    if (sentence) emitted.push(sentence);
    return emitted;
  }

  get current(): string {
    return this.sentence !== "" ? this.sentence : this.buffer;
  }

  private addLine(line: CaptionLine): CaptionLine[] {
    if (this.sentence === "") this.sentenceStart = line.start;
    this.sentence = `${this.sentence} ${line.text}`.trim();
    const duration = line.end - this.sentenceStart;
    const complete = SENTENCE_END.test(this.sentence) || this.sentence.length >= this.maxChars || duration >= this.maxSeconds;
    if (!complete) return [];
    const emitted = this.takeSentence(line.end);
    return emitted ? [emitted] : [];
  }

  private takeSentence(end: number): CaptionLine | null {
    if (this.sentence === "") return null;
    const line: CaptionLine = {
      text: this.sentence,
      start: this.sentenceStart,
      end: Math.max(this.sentenceStart + 0.8, end),
    };
    this.sentence = "";
    this.sentenceStart = 0;
    return line;
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

/** Đọc phụ đề ngay trên player (không cần API/panel). Bật CC nếu chưa bật. */
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
    for (const line of tracker.push(readCaptionText(doc), video.currentTime)) onLine(line);
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
