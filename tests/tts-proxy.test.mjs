import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_TTS_HOSTS,
  base64ToBytes,
  bytesToBase64,
  isAllowedTtsUrl,
} from "../lib/tts/proxy.ts";

const TTS_URL =
  "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=" +
  encodeURIComponent("xin chào");

test("isAllowedTtsUrl chỉ nhận endpoint TTS của Google", () => {
  assert.equal(isAllowedTtsUrl(TTS_URL), true);
  assert.equal(isAllowedTtsUrl("https://translate.googleapis.com/translate_tts?tl=vi"), true);

  assert.equal(isAllowedTtsUrl("https://example.com/translate_tts"), false);
  assert.equal(isAllowedTtsUrl("http://translate.google.com/translate_tts"), false, "chỉ https");
  assert.equal(isAllowedTtsUrl("https://translate.google.com.evil.tld/x"), false);
  assert.equal(isAllowedTtsUrl("not a url"), false);
  assert.deepEqual(ALLOWED_TTS_HOSTS, ["translate.google.com", "translate.googleapis.com"]);
});

test("base64 round-trip giữ nguyên bytes", () => {
  const bytes = new Uint8Array(5000);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

  const encoded = bytesToBase64(bytes);
  assert.equal(typeof encoded, "string");
  assert.ok(encoded.length > 0);

  const decoded = base64ToBytes(encoded);
  assert.equal(decoded.length, bytes.length);
  assert.deepEqual(Array.from(decoded.slice(0, 512)), Array.from(bytes.slice(0, 512)));
  assert.deepEqual(Array.from(decoded.slice(-512)), Array.from(bytes.slice(-512)));
});

test("base64 với mảng rỗng và mảng lớn hơn một chunk", () => {
  assert.equal(bytesToBase64(new Uint8Array(0)), "");
  assert.equal(base64ToBytes("").length, 0);

  const big = new Uint8Array(0x8000 * 2 + 7).fill(7);
  const roundTrip = base64ToBytes(bytesToBase64(big));
  assert.equal(roundTrip.length, big.length);
  assert.equal(roundTrip.every((byte) => byte === 7), true);
});
