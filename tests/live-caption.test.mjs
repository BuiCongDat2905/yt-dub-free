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

test("tracker gom caption hiện dần thành một dòng", () => {
  const tracker = new CaptionLineTracker();
  assert.deepEqual(tracker.push("Xin", 1), []);
  assert.deepEqual(tracker.push("Xin chào", 1.2), []);
  assert.deepEqual(tracker.push("Xin chào các", 1.4), []);
  assert.deepEqual(tracker.push("Xin chào các bạn", 1.6), []);

  const emitted = tracker.push("Dòng tiếp theo", 3);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].text, "Xin chào các bạn");
  assert.equal(emitted[0].start, 1);
  assert.equal(emitted[0].end, 3);
});

test("tracker phát dòng khi caption biến mất", () => {
  const tracker = new CaptionLineTracker();
  tracker.push("một câu ngắn", 2);
  const emitted = tracker.push("", 4.5);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].start, 2);
  assert.equal(emitted[0].end, 4.5);

  assert.deepEqual(tracker.push("", 5), [], "flush lần hai không phát lại");
});

test("tracker bỏ qua caption co lại do xuống dòng", () => {
  const tracker = new CaptionLineTracker();
  tracker.push("Hello everyone welcome back", 0);
  assert.deepEqual(tracker.push("Hello everyone", 0.4), []);
  assert.equal(tracker.current, "Hello everyone welcome back");
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
