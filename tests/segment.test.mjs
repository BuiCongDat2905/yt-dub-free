import test from "node:test";
import assert from "node:assert/strict";

import { isSentenceEnd, mergeCaptionText, segmentCues } from "../lib/subtitle/segment.ts";

test("mergeCaptionText cắt chữ lặp ở chỗ ngắt", () => {
  assert.equal(mergeCaptionText("hello everyone", "everyone welcome home"), "hello everyone welcome home");
  assert.equal(mergeCaptionText("Xin chào", "chào các bạn"), "Xin chào các bạn");
  assert.equal(mergeCaptionText("abc", "abc"), "abc");
  assert.equal(mergeCaptionText("a b", "c d"), "a b c d");
  assert.equal(mergeCaptionText("", "x"), "x");
  assert.equal(mergeCaptionText("x", ""), "x");
  assert.equal(mergeCaptionText("một hai ba", "ba bốn"), "một hai ba bốn");
});

test("segmentCues không lặp cụm khi caption chồng lấn", () => {
  const cues = segmentCues([
    cue(0, 1.5, "hôm nay chúng ta"),
    cue(1.5, 3, "chúng ta sẽ học"),
    cue(3, 4.5, "sẽ học về lồng tiếng."),
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "hôm nay chúng ta sẽ học về lồng tiếng.");
});

const cue = (start, end, text) => ({ start, end, text });

function assertInvariants(cues, maxChars = 120, maxDuration = 15) {
  for (const item of cues) {
    assert.ok(item.text.length > 0, `cue rỗng: ${JSON.stringify(item)}`);
    assert.ok(item.text.length <= maxChars, `quá dài ${item.text.length}: ${item.text}`);
    assert.ok(item.end > item.start, `end <= start: ${JSON.stringify(item)}`);
    assert.ok(item.end - item.start <= maxDuration + 0.001, `quá dài ${item.end - item.start}s`);
  }
  for (let index = 1; index < cues.length; index += 1) {
    assert.ok((cues[index]?.start ?? 0) >= (cues[index - 1]?.start ?? 0), "không được lệch thứ tự");
  }
}

test("isSentenceEnd nhận dấu câu kèm ngoặc/nháy", () => {
  assert.equal(isSentenceEnd("Xong rồi."), true);
  assert.equal(isSentenceEnd("Thật sao?!"), true);
  assert.equal(isSentenceEnd("Kết thúc.”"), true);
  assert.equal(isSentenceEnd("chưa xong"), false);
  assert.equal(isSentenceEnd("giữa, câu"), false);
});

test("gộp mảnh caption thành một câu", () => {
  const cues = segmentCues([
    cue(0, 1.2, "Xin chào các bạn"),
    cue(1.2, 2.4, "hôm nay chúng ta"),
    cue(2.4, 3.6, "sẽ học REA."),
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "Xin chào các bạn hôm nay chúng ta sẽ học REA.");
  assert.equal(cues[0]?.start, 0);
  assert.equal(cues[0]?.end, 3.6);
});

test("không gộp qua dấu kết câu", () => {
  const cues = segmentCues([cue(0, 1, "Câu một xong."), cue(1, 2, "Câu hai bắt đầu")]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0]?.text, "Câu một xong.");
  assert.equal(cues[1]?.text, "Câu hai bắt đầu");
});

test("cắt ở khoảng lặng >= 0.15s", () => {
  const cues = segmentCues([cue(0, 1, "phần đầu"), cue(1.2, 2, "phần sau")]);
  assert.equal(cues.length, 2);
});

test("không cắt khi khoảng lặng nhỏ hơn ngưỡng", () => {
  const cues = segmentCues([cue(0, 1, "phần đầu"), cue(1.05, 2, "phần sau")]);
  assert.equal(cues.length, 1);
});

test("tách câu dài không có dấu câu theo số ký tự", () => {
  const long = `${"từ ngắn ".repeat(30)}hết`.trim();
  assert.ok(long.length > 120);
  const cues = segmentCues([cue(0, 12, long)]);
  assert.ok(cues.length >= 2);
  assertInvariants(cues);
  assert.equal(cues.map((item) => item.text).join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
});

test("tách câu dài theo thời lượng 20s", () => {
  const cues = segmentCues([cue(0, 20, "một hai ba bốn năm sáu bảy tám chín mười")]);
  assert.ok(cues.length >= 2);
  assertInvariants(cues);
});

test("gộp câu rời quá ngắn vào câu trước", () => {
  const cues = segmentCues([cue(0, 2, "Đây là một câu khá dài để kiểm tra"), cue(2, 2.3, "ừ")]);
  assert.equal(cues.length, 1);
  assertInvariants(cues);
});

test("không gộp câu rời vào sau dấu kết câu", () => {
  const cues = segmentCues([cue(0, 2, "Xong rồi."), cue(2, 2.2, "Ừ")]);
  assert.equal(cues.length, 2);
});

test("input rỗng trả mảng rỗng", () => {
  assert.deepEqual(segmentCues([]), []);
});

test("fixture kiểu auto-caption thật vẫn giữ bất biến", () => {
  const cues = segmentCues([
    cue(0.32, 2.1, "và đây là"),
    cue(2.1, 4.4, "một ví dụ về cách"),
    cue(4.4, 6.8, "hệ thống xử lý âm thanh."),
    cue(7.6, 9.2, "bước tiếp theo"),
    cue(9.2, 11.0, "là dịch sang tiếng Việt"),
    cue(11.0, 13.4, "rồi tổng hợp giọng nói."),
    cue(14.0, 15.2, "cuối cùng là phát lại"),
    cue(15.2, 16.8, "theo đúng mốc thời gian."),
  ]);
  assert.equal(cues.length, 3);
  assertInvariants(cues);
  assert.equal(cues[0]?.text, "và đây là một ví dụ về cách hệ thống xử lý âm thanh.");
  assert.equal(cues[2]?.text, "cuối cùng là phát lại theo đúng mốc thời gian.");
});
