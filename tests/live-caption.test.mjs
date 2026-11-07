import test from "node:test";
import assert from "node:assert/strict";

import {
  CaptionLineTracker,
  cuesFromLines,
  normalizeCaptionText,
} from "../lib/youtube/liveCaption.ts";

test("normalizeCaptionText gộp khoảng trắng và trim", () => {
  assert.equal(normalizeCaptionText("  Xin   chào\n các bạn  "), "Xin chào các bạn");
  assert.equal(normalizeCaptionText("   "), "");
});

test("tracker gộp nhiều dòng thành một câu, chỉ phát khi hết câu", () => {
  const tracker = new CaptionLineTracker();
  assert.deepEqual(tracker.push("Hello everyone", 1), []);
  assert.deepEqual(tracker.push("welcome back to the channel", 2), [], "chưa có dấu kết câu");
  assert.deepEqual(tracker.push("today we test dubbing.", 3), [], "dòng mới chỉ chốt dòng trước");
  const emitted = tracker.push("đây là dòng kế tiếp", 4);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].text, "Hello everyone welcome back to the channel today we test dubbing.");
  assert.equal(emitted[0].start, 1);
  assert.equal(emitted[0].end, 4);
});

test("tracker phát câu dở khi caption biến mất", () => {
  const tracker = new CaptionLineTracker();
  tracker.push("một câu không có dấu chấm", 2);
  const emitted = tracker.push("", 5);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].text, "một câu không có dấu chấm");
  assert.equal(emitted[0].end, 5);
  assert.deepEqual(tracker.push("", 6), []);
});

test("tracker cắt câu quá dài theo số ký tự", () => {
  const tracker = new CaptionLineTracker({ maxChars: 40 });
  tracker.push("một hai ba bốn năm sáu bảy", 1);
  tracker.push("tám chín mười mười một", 2);
  const emitted = tracker.push("mười hai mười ba", 3);
  assert.equal(emitted.length, 1);
  assert.ok(emitted[0].text.length >= 40);
});

test("tracker cắt câu theo thời lượng tối đa", () => {
  const tracker = new CaptionLineTracker({ maxSeconds: 3 });
  tracker.push("dòng thứ nhất", 0);
  const emitted = tracker.push("dòng thứ hai", 4);
  assert.equal(emitted.length, 1);
});

test("tracker bỏ qua caption co lại do xuống dòng", () => {
  const tracker = new CaptionLineTracker();
  tracker.push("Hello everyone welcome back", 0);
  assert.deepEqual(tracker.push("Hello everyone", 0.4), []);
  assert.ok(tracker.current.includes("welcome back"));
});

test("tracker không phát trùng khi text không đổi", () => {
  const tracker = new CaptionLineTracker();
  tracker.push("một câu", 1);
  assert.deepEqual(tracker.push("một câu", 1.5), []);
  assert.deepEqual(tracker.push("một câu", 1.9), []);
});

test("cuesFromLines dịch thời gian theo lag và bảo đảm end > start", () => {
  const cues = cuesFromLines([{ text: "a", start: 1, end: 3 }, { text: "b", start: 3, end: 3 }], 1.2);
  assert.equal(cues[0].start, 2.2);
  assert.equal(cues[0].end, 4.2);
  assert.ok(cues[1].end > cues[1].start);
});
