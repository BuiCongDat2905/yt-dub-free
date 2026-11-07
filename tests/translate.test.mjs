import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranslateUrl,
  parseGoogleResponse,
  splitForTranslation,
  translateBatch,
} from "../lib/translate/google.ts";
import { hashText } from "../lib/cache/idb.ts";

const okResponse = (translated) => ({
  ok: true,
  json: async () => [[[translated, "orig", null, null, 1]], null, "en"],
});

test("buildTranslateUrl mã hoá câu và đặt đủ tham số", () => {
  const url = new URL(buildTranslateUrl("xin chào & tạm biệt", "vi"));
  assert.equal(url.origin, "https://translate.googleapis.com");
  assert.equal(url.pathname, "/translate_a/single");
  assert.equal(url.searchParams.get("client"), "gtx");
  assert.equal(url.searchParams.get("tl"), "vi");
  assert.equal(url.searchParams.get("sl"), "auto");
  assert.equal(url.searchParams.get("dt"), "t");
  assert.equal(url.searchParams.get("q"), "xin chào & tạm biệt");
});

test("parseGoogleResponse ghép mảnh và bỏ phần lạ", () => {
  assert.equal(
    parseGoogleResponse([[["Xin ", "Xin "], ["chào", null], [" bạn", 123]], null, "en"]),
    "Xin chào bạn",
  );
  assert.equal(parseGoogleResponse(null), "");
  assert.equal(parseGoogleResponse({}), "");
  assert.equal(parseGoogleResponse([]), "");
});

test("splitForTranslation không mất chữ", () => {
  const text = `${"từ ".repeat(2000)}cuối`;
  const chunks = splitForTranslation(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));
  assert.deepEqual(splitForTranslation("ngắn"), ["ngắn"]);
});

test("translateBatch giữ đúng thứ tự dù response về lệch nhịp", async () => {
  const delays = [30, 1, 20, 5];
  let call = 0;
  const fetchImpl = async (url) => {
    const index = call;
    call += 1;
    const q = new URL(url).searchParams.get("q");
    await new Promise((resolve) => setTimeout(resolve, delays[index] ?? 0));
    return okResponse(`vi:${q}`);
  };

  const texts = ["một", "hai", "ba", "bốn"];
  const result = await translateBatch(texts, { fetchImpl, concurrency: 4 });
  assert.deepEqual(result, ["vi:một", "vi:hai", "vi:ba", "vi:bốn"]);
});

test("translateBatch dùng cache, không gọi lại mạng", async () => {
  const store = new Map();
  const cache = {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };

  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    return okResponse(`vi:${new URL(url).searchParams.get("q")}`);
  };

  const first = await translateBatch(["xin chào", "tạm biệt"], { fetchImpl, cache });
  const second = await translateBatch(["xin chào", "tạm biệt"], { fetchImpl, cache });

  assert.deepEqual(first, ["vi:xin chào", "vi:tạm biệt"]);
  assert.deepEqual(second, first);
  assert.equal(calls, 2, "lần hai phải lấy từ cache");
});

test("translateBatch retry khi lỗi rồi thành công", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) throw new Error("mạng hỏng");
    return okResponse(`vi:${new URL(url).searchParams.get("q")}`);
  };
  const result = await translateBatch(["một câu"], { fetchImpl, retries: 2 });
  assert.deepEqual(result, ["vi:một câu"]);
  assert.equal(calls, 2);
});

test("translateBatch để câu rỗng nguyên và không gọi mạng", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    return okResponse(`vi:${new URL(url).searchParams.get("q")}`);
  };
  const result = await translateBatch(["", "  ", "câu"], { fetchImpl });
  assert.deepEqual(result, ["", "", "vi:câu"]);
  assert.equal(calls, 1);
});

test("hashText ổn định và đúng SHA-256", async () => {
  const first = await hashText("xin chào");
  const second = await hashText("xin chào");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, await hashText("xin chào "));
  assert.equal(
    await hashText("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
