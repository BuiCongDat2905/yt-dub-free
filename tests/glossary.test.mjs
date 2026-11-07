import test from "node:test";
import assert from "node:assert/strict";

import {
  containsEnglishTerm,
  findTermSpans,
  protectTerms,
  restoreTerms,
  splitMixedSegments,
} from "../lib/glossary/terms.ts";

test("findTermSpans tìm thuật ngữ theo từ nguyên vẹn", () => {
  const spans = findTermSpans("Tôi dùng React với API và cache dữ liệu.");
  assert.deepEqual(spans.map((span) => span.term), ["React", "API", "cache"]);
  assert.equal(findTermSpans("reaction apis caching").length, 0, "không khớp bên trong từ khác");
});

test("protectTerms thay thuật ngữ bằng token trước khi dịch", () => {
  const { masked, terms } = protectTerms("Dùng React và Node.js để build API.");
  assert.equal(terms.length, 4);
  assert.ok(!masked.includes("React"));
  assert.ok(masked.includes("[[0]]"));
});

test("restoreTerms trả lại đúng thuật ngữ gốc", () => {
  const { terms } = protectTerms("Dùng React và Node.js để build API.");
  const restored = restoreTerms("Sử dụng [[0]] và [[1]] để xây dựng [[2]] [[3]].", terms);
  assert.equal(restored, "Sử dụng React và Node.js để xây dựng build API.");
});

test("restoreTerms để nguyên token lạ", () => {
  assert.equal(restoreTerms("a [[9]] b", ["x"]), "a [[9]] b");
});

test("splitMixedSegments tách câu Việt/Anh để đọc đúng giọng", () => {
  const segments = splitMixedSegments("Dùng React và API để build giao diện.");
  assert.deepEqual(
    segments.map((segment) => segment.lang),
    ["vi", "en", "vi", "en", "vi", "en", "vi"],
  );
  const joined = segments.map((segment) => segment.text).join(" ");
  for (const word of ["Dùng", "React", "API", "build", "giao", "diện"]) {
    assert.ok(joined.includes(word), `thiếu ${word}`);
  }
});

test("splitMixedSegments giữ một đoạn vi khi không có thuật ngữ", () => {
  assert.deepEqual(splitMixedSegments("xin chào các bạn"), [{ text: "xin chào các bạn", lang: "vi" }]);
  assert.deepEqual(splitMixedSegments("   "), []);
});

test("containsEnglishTerm nhận diện thuật ngữ", () => {
  assert.equal(containsEnglishTerm("dùng Docker"), true);
  assert.equal(containsEnglishTerm("xin chào"), false);
});
