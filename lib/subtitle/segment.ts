import type { Cue } from "./types.ts";
import { normalizeCues } from "./parse.ts";

export interface SegmentOptions {
  /** Số ký tự tối đa cho một câu. */
  maxChars?: number;
  /** Thời lượng tối đa (giây) cho một câu. */
  maxDuration?: number;
  /** Câu ngắn hơn ngưỡng này sẽ được gộp vào câu trước nếu còn chỗ. */
  minChars?: number;
  /** Thời lượng tối thiểu (giây) để không bị coi là câu rời. */
  minDuration?: number;
  /** Khoảng lặng (giây) đủ lớn để cắt câu. */
  silenceGap?: number;
}

const DEFAULTS: Required<SegmentOptions> = {
  maxChars: 120,
  maxDuration: 15,
  minChars: 12,
  minDuration: 0.6,
  silenceGap: 0.15,
};

const SENTENCE_END = /[.!?。！？…]+["'”’)\]」』]*\s*$/u;
const SOFT_BREAK = /[,;:、，；：]/u;

export function isSentenceEnd(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

/**
 * Nối hai mảnh caption, cắt phần chữ bị lặp ở chỗ ngắt.
 * ASR hay trả "hello everyone" rồi "everyone welcome home" → "hello everyone welcome home".
 */
export function mergeCaptionText(base: string, addition: string): string {
  const left = base.trim();
  const right = addition.trim();
  if (left === "") return right;
  if (right === "") return left;
  if (left.endsWith(right)) return left;

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(leftWords.length, rightWords.length);

  for (let size = maxOverlap; size >= 1; size -= 1) {
    const tail = leftWords.slice(-size).join(" ").toLowerCase();
    const head = rightWords.slice(0, size).join(" ").toLowerCase();
    if (tail === head) {
      const rest = rightWords.slice(size).join(" ");
      return rest === "" ? left : `${left} ${rest}`;
    }
  }
  return `${left} ${right}`;
}

function timeAtOffset(cue: Cue, offset: number): number {
  const length = Math.max(1, cue.text.length);
  const ratio = Math.min(1, Math.max(0, offset / length));
  return cue.start + (cue.end - cue.start) * ratio;
}

function findCut(text: string, target: number, hardMax: number): number {
  const floor = Math.max(target - 40, 10);
  for (let index = Math.min(hardMax, text.length - 1); index > floor; index -= 1) {
    const char = text[index - 1] ?? "";
    if (char === " " || SOFT_BREAK.test(char)) return index;
  }
  const space = text.lastIndexOf(" ", Math.min(hardMax, text.length - 1));
  if (space > floor) return space + 1;
  return Math.min(hardMax, text.length);
}

function splitLongCue(cue: Cue, limits: Required<SegmentOptions>): Cue[] {
  const duration = Math.max(0.05, cue.end - cue.start);
  const length = cue.text.length;
  if (length <= limits.maxChars && duration <= limits.maxDuration) return [cue];

  const charsPerSecond = length / duration;
  const timeBudget = Math.max(20, Math.floor(limits.maxDuration * charsPerSecond));
  const pieceBudget = Math.max(20, Math.min(limits.maxChars, timeBudget));

  const pieces: Cue[] = [];
  let offset = 0;
  while (offset < length) {
    const remaining = length - offset;
    if (remaining <= pieceBudget) {
      pieces.push({
        start: timeAtOffset(cue, offset),
        end: cue.end,
        text: cue.text.slice(offset).trim(),
      });
      break;
    }
    const cut = findCut(cue.text, offset + pieceBudget, offset + pieceBudget);
    pieces.push({
      start: timeAtOffset(cue, offset),
      end: timeAtOffset(cue, cut),
      text: cue.text.slice(offset, cut).trim(),
    });
    offset = cut;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

/** Gộp mảnh caption thành câu, rồi tách câu quá dài theo ký tự/thời lượng. */
export function segmentCues(cues: Cue[], options: SegmentOptions = {}): Cue[] {
  const limits: Required<SegmentOptions> = { ...DEFAULTS, ...options };
  const normalized = normalizeCues(cues);
  if (normalized.length === 0) return [];

  const merged: Cue[] = [];
  let buffer: Cue | null = null;

  for (const cue of normalized) {
    if (!buffer) {
      buffer = { ...cue };
      continue;
    }

    const gap = cue.start - buffer.end;
    const joined = mergeCaptionText(buffer.text, cue.text);
    const combinedDuration = cue.end - buffer.start;
    const mustBreak =
      gap >= limits.silenceGap ||
      isSentenceEnd(buffer.text) ||
      joined.length > limits.maxChars ||
      combinedDuration > limits.maxDuration;

    if (mustBreak) {
      merged.push(buffer);
      buffer = { ...cue };
    } else {
      buffer = { start: buffer.start, end: cue.end, text: joined };
    }
  }
  if (buffer) merged.push(buffer);

  const split = merged.flatMap((cue) => splitLongCue(cue, limits));

  const result: Cue[] = [];
  for (const cue of split) {
    const previous = result[result.length - 1];
    const gap = previous ? cue.start - previous.end : Number.POSITIVE_INFINITY;
    const mergedText = previous ? mergeCaptionText(previous.text, cue.text) : cue.text;
    const tiny = cue.text.length < limits.minChars || cue.end - cue.start < limits.minDuration;
    const fits = previous ? mergedText.length <= limits.maxChars : false;
    const fitsDuration = previous ? cue.end - previous.start <= limits.maxDuration : false;
    if (previous && tiny && fits && fitsDuration && gap < limits.silenceGap && !isSentenceEnd(previous.text)) {
      previous.text = mergedText;
      previous.end = cue.end;
    } else {
      result.push({ ...cue });
    }
  }

  return normalizeCues(result);
}
