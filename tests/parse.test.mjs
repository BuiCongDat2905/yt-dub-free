import test from "node:test";
import assert from "node:assert/strict";

import { cleanText, normalizeCues, parseJson3, parseVtt } from "../lib/subtitle/parse.ts";
import { pickTrack } from "../lib/youtube/captions.ts";
import { extractPlayerResponse, toCaptionTracks } from "../lib/youtube/innertube.ts";

test("cleanText bỏ thẻ, giải mã entity, gộp khoảng trắng", () => {
  assert.equal(cleanText("<b>Xin</b>\n chào   &amp; tạm biệt"), "Xin chào & tạm biệt");
});

test("parseJson3 đọc sự kiện segs, bỏ aAppend và cue rỗng", () => {
  const raw = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Xin chào\n" }] },
      { tStartMs: 1500, dDurationMs: 1000, segs: [{ utf8: "thế giới", tOffsetMs: 200 }] },
      { tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: "nối tiếp" }], aAppend: 1 },
      { tStartMs: 2600, dDurationMs: 700, segs: [{ utf8: "   " }] },
    ],
  });

  const cues = parseJson3(raw);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 1.5, text: "Xin chào" });
  assert.equal(cues[1].text, "thế giới");
  assert.equal(cues[1].start, 1.5);
});

test("parseJson3 chịu được JSON hỏng", () => {
  assert.deepEqual(parseJson3("{not json"), []);
  assert.deepEqual(parseJson3("{}"), []);
});

test("parseVtt đọc timestamp có giờ và không giờ, bỏ thẻ inline", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.000 --> 00:00:03.500 align:start",
    "<c.yellow>Xin</c> chào",
    "",
    "00:04.000 --> 00:05.000",
    "tạm biệt",
  ].join("\n");

  const cues = parseVtt(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: "Xin chào" });
  assert.deepEqual(cues[1], { start: 4, end: 5, text: "tạm biệt" });
});

test("normalizeCues sắp xếp, cắt chồng lấn, ép end > start", () => {
  const cues = normalizeCues([
    { start: 5, end: 4, text: "ngược" },
    { start: 0, end: 2, text: "một" },
    { start: 1, end: 3, text: "hai" },
    { start: 2, end: 2.5, text: "" },
  ]);

  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["một", "hai", "ngược"],
  );
  assert.equal(cues[0].end <= cues[1].start, true);
  assert.equal(cues[2].end > cues[2].start, true);
});

test("normalizeCues bỏ cue lặp do caption ASR cuộn lại", () => {
  const cues = normalizeCues([
    { start: 0, end: 2, text: "hello everyone" },
    { start: 1.5, end: 3, text: "hello everyone" },
    { start: 3, end: 4.5, text: "everyone welcome" },
    { start: 4.5, end: 6, text: "back home" },
  ]);

  for (let index = 1; index < cues.length; index += 1) {
    assert.notEqual(cues[index].text, cues[index - 1].text, "không được có text trùng liền nhau");
  }
  assert.equal(cues.some((cue) => cue.text === "hello everyone"), true);
  assert.equal(cues.some((cue) => cue.text === "back home"), true);
});

test("normalizeCues giữ cue trùng chữ nếu không chồng thời gian", () => {
  const cues = normalizeCues([
    { start: 0, end: 1, text: "ok" },
    { start: 1, end: 2, text: "ok" },
  ]);
  assert.equal(cues.length, 2, "hai câu nối tiếp thì không phải lặp");
});

test("pickTrack ưu tiên track người tạo khớp ngôn ngữ, rồi asr, rồi bất kỳ", () => {
  const asrEn = { baseUrl: "https://a", languageCode: "en", kind: "asr" };
  const manualEn = { baseUrl: "https://b", languageCode: "en" };
  const manualVi = { baseUrl: "https://c", languageCode: "vi" };

  assert.equal(pickTrack([asrEn, manualVi, manualEn], "en"), manualEn);
  assert.equal(pickTrack([asrEn, manualVi], "en"), asrEn);
  assert.equal(pickTrack([manualVi], "en"), manualVi);
  assert.equal(pickTrack([], "en"), undefined);
});

test("extractPlayerResponse cắt JSON có ngoặc trong chuỗi", () => {
  const html = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://x/a?b=1","languageCode":"en","kind":"asr","name":{"simpleText":"English (auto)"}}]}},"title":"a } brace"};</script>`;
  const response = extractPlayerResponse(html);
  const tracks = toCaptionTracks(response);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].languageCode, "en");
  assert.equal(tracks[0].kind, "asr");
  assert.equal(tracks[0].name, "English (auto)");
});

test("toCaptionTracks bỏ track thiếu baseUrl", () => {
  const response = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ languageCode: "en" }, { baseUrl: "https://ok", languageCode: "vi" }],
      },
    },
  };
  const tracks = toCaptionTracks(response);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].languageCode, "vi");
});
