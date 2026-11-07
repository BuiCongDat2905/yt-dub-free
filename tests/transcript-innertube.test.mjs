import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranscriptParams,
  extractInnertubeConfig,
  extractTranscriptParams,
  extractTranscriptParamsCandidates,
  normalizeTranscriptParams,
  parseTranscriptSegments,
  pickTranscriptParams,
} from "../lib/youtube/transcriptInnertube.ts";

const PARAMS_MAIN = "CgtkUXc0dzlXZ1hjURIOQ2dBU0FtVnVHZ0ElM0QY";
const PARAMS_OTHER = "CgtvdGhlclZpZGVv";

const HTML = `
<script nonce="x">var ytcfg={};ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyFAKE_KEY_123","INNERTUBE_CLIENT_VERSION":"2.20261105.05.01","VISITOR_DATA":"Cgt2aXNpdG9yRGF0YQ%3D%3D"});</script>
<script nonce="y">var ytInitialData={"engagementPanels":[{"panel":{"getTranscriptEndpoint":{"params":"${PARAMS_MAIN}"}}}]};</script>
<script nonce="z">var sideBar={"x":{"getTranscriptEndpoint":{"params":"${PARAMS_OTHER}"}}};</script>
`;

const TRANSCRIPT_PAYLOAD = {
  actions: [
    {
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            content: {
              transcriptBodyRenderer: {
                transcriptSegmentListRenderer: {
                  initialSegments: [
                    {
                      transcriptSegmentRenderer: {
                        startMs: "0",
                        endMs: "1500",
                        snippet: { runs: [{ text: "Hello " }, { text: "everyone." }] },
                      },
                    },
                    {
                      transcriptSegmentRenderer: {
                        startMs: "1500",
                        endMs: "3000",
                        snippet: { simpleText: "Welcome back." },
                      },
                    },
                    { transcriptSegmentRenderer: { startMs: 3000, endMs: 4000, snippet: { runs: [{ text: "  " }] } } },
                  ],
                },
              },
            },
          },
        },
      },
    },
  ],
};

test("extractInnertubeConfig decode visitorData và lấy api key/client version", () => {
  const config = extractInnertubeConfig(HTML);
  assert.equal(config.apiKey, "AIzaSyFAKE_KEY_123");
  assert.equal(config.clientVersion, "2.20261105.05.01");
  assert.equal(config.visitorData, "Cgt2aXNpdG9yRGF0YQ==", "phải decode %3D%3D");

  assert.deepEqual(extractInnertubeConfig("<html></html>"), {
    apiKey: null,
    clientVersion: null,
    visitorData: null,
  });
});

test("extractTranscriptParamsCandidates gom mọi endpoint, không trùng", () => {
  const candidates = extractTranscriptParamsCandidates(HTML);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.includes(PARAMS_MAIN));
  assert.ok(candidates.includes(PARAMS_OTHER));
  assert.equal(extractTranscriptParams(HTML), PARAMS_MAIN);
});

test("pickTranscriptParams chọn params chứa đúng videoId", () => {
  const forRick = pickTranscriptParams(HTML, "dQw4w9WgXcQ");
  assert.equal(forRick.matched, true);
  assert.equal(forRick.params, PARAMS_MAIN);
  assert.equal(forRick.candidates, 2);

  const forOther = pickTranscriptParams(HTML, "otherVideo");
  assert.equal(forOther.matched, true);
  assert.equal(forOther.params, PARAMS_OTHER);

  const unknown = pickTranscriptParams(HTML, "khongCoVideoNay");
  assert.equal(unknown.matched, false);
  assert.equal(unknown.params, PARAMS_MAIN, "fallback candidate đầu tiên");
});

test("buildTranscriptParams tạo protobuf hợp lệ chứa videoId", () => {
  const params = buildTranscriptParams("dQw4w9WgXcQ");
  const decoded = atob(params);
  assert.ok(decoded.includes("dQw4w9WgXcQ"));
  assert.equal(decoded.charCodeAt(0), 0x0a);
  assert.equal(decoded.charCodeAt(1), 11);
});

test("normalizeTranscriptParams decode %3D bên trong params", () => {
  const encoded =
    "CgtSbTB0MUt3Rm1CdxISQ2dOaGMzSVNBbVZ1R2dBJTNEGAEqM2VuZ2FnZW1lbnQtcGFuZWwtc2VhcmNoYWJsZS10cmFuc2NyaXB0";
  const decoded = normalizeTranscriptParams(encoded);
  assert.notEqual(decoded, encoded, "phải giải mã %3D");
  assert.ok(decoded.includes("="), "base64 padding phải thành dấu =");

  const padded = decoded.padEnd(Math.ceil(decoded.length / 4) * 4, "=");
  assert.ok(atob(padded).includes("Rm0t1KwFmBw"), "params phải chứa videoId");

  assert.equal(normalizeTranscriptParams("abc123"), "abc123", "params sạch giữ nguyên");
  assert.equal(normalizeTranscriptParams("%ZZ"), "%ZZ", "escape hỏng thì giữ nguyên");
});

test("extractTranscriptParamsCandidates trả params đã chuẩn hoá", () => {
  const html = `<script>{"getTranscriptEndpoint":{"params":"CgtSbTB0MUt3Rm1CdxISQ2dOaGMzSVNBbVZ1R2dBJTNEGAEq"}}</script>`;
  const [params] = extractTranscriptParamsCandidates(html);
  assert.ok(params);
  assert.ok(!params.includes("%3D"), "không được giữ %3D");
});

test("parseTranscriptSegments đọc runs, simpleText, bỏ segment rỗng", () => {
  const cues = parseTranscriptSegments(TRANSCRIPT_PAYLOAD);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 1.5, text: "Hello everyone." });
  assert.deepEqual(cues[1], { start: 1.5, end: 3, text: "Welcome back." });
});

test("parseTranscriptSegments chịu payload lạ", () => {
  assert.deepEqual(parseTranscriptSegments(null), []);
  assert.deepEqual(parseTranscriptSegments({}), []);
  assert.deepEqual(parseTranscriptSegments([]), []);
  assert.deepEqual(parseTranscriptSegments("string"), []);
});

test("parseTranscriptSegments dùng 800ms mặc định khi thiếu endMs", () => {
  const cues = parseTranscriptSegments({
    a: { transcriptSegmentRenderer: { startMs: 2000, snippet: { simpleText: "một câu" } } },
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 2);
  assert.ok(cues[0].end > 2);
});
