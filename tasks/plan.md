# Implementation Plan: YouTube dubbing extension, bản miễn phí (Chrome MV3)

## Overview

Dựng lại tính năng "lồng tiếng video YouTube" bằng một extension Chrome MV3 độc lập, chạy hoàn toàn ở client, không server, không tài khoản, không phí. Pipeline: lấy caption có sẵn của YouTube → cắt thành câu → dịch sang tiếng Việt → TTS → phát audio đã dịch khớp mốc thời gian, hạ tiếng gốc.

Phân phối: **load unpacked**, không đăng Chrome Web Store. Chi phí: **0**.

## Reverse-engineering findings (bằng chứng từ Edge `4.5.12_0`)

Nguồn: extension đã cài tại
`%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Extensions\oglffgiaiekgeicdgkdlnlkhliajdlja\4.5.12_0\`
(`manifest.json`, `background.js`, `chunks/*.js`, `content-scripts/*.js`).

| Thành phần | Phát hiện | Ý nghĩa cho bản clone |
| --- | --- | --- |
| Build | WXT + Vite, Vue 3, MV3, `background.service_worker` | Dùng WXT + MV3, không cần Vue |
| Backend | `https://yd.transduck.com` (`/api/v2/...`, `/api/servertime`) | **Không** dùng. Bỏ toàn bộ |
| Auth | header `Ck` lấy từ `local:SESSION` | Không cần |
| Membership | `/api/v2/membership/getMembership`, `getPopupInfo`; locale key `azureRequireMembership` | Đây là cổng thu phí: Azure voice + engine dịch LLM là trả phí |
| Engine dịch | `translateEngine`: `google` (free) vs `gemini-*`, `deepseek-*`, `gpt-*`, `claude-*` (member) | Bản free dùng `google` |
| Translator | `https://api.cognitive.microsofttranslator.com` (Azure) | Không cần, thay bằng endpoint dịch free |
| TTS | Edge/Azure Neural voice, có `DragonHDLatestNeural`; `EdgeTtsTokenCache` + `/api/servertime` để canh `exp` của JWT | Bản free gọi thẳng Edge TTS, không qua backend |
| Encoding | `assets/encoder.worker`, `subtitle-audio/lame.wasm`, ràng buộc 24 kHz mono 64 kbps | Dùng MP3 24 kHz mono; hoặc bỏ MP3, phát PCM |
| Segmentation | `/api/v2/dubbing/resolve-segmentation` → mode `MICROSOFT` \| `LEGACY`; hằng `SUBTITLE_GAP_THRESHOLD=0.15`, `LONG_SUBTITLE_THRESHOLD=60` | Tự cắt câu theo dấu câu + khoảng lặng 0.15 s |
| Runtime | `RealtimeDubbingEngine`, `SubtitleAudioCache.worker`, `local-player.html`, `srt/ssa/vtt` parser, `video.js` 8.23.8 (HLS), `howler` | Bản clone: audio element + WebAudio, không cần video.js |
| Caption | parser WebVTT/TTML/YouTube `events[].segs[].utf8`, `tStartMs`, `dDurationMs`, `tOffsetMs` | Đây là định dạng cần đọc |
| UI | content script overlay + sidebar 370 px, hotkey `Alt+D` / `Alt+S` / `Alt+C` | Giữ 1 hotkey bật/tắt |
| Phạm vi site | YouTube, `youtube.com/embed`, Vimeo embed, Kinescope, Medality, Plannerly, GDC Vault, Memberspot… | Bản đầu chỉ làm YouTube |
| Quyền | `storage`, `contextMenus`, `activeTab`, `webRequest`, `webNavigation`, `declarativeNetRequest`, `scripting`, `host_permissions: <all_urls>` | Chỉ cần `storage`, `scripting`, `activeTab`, host `youtube.com` + endpoint dịch |

Kết luận kỹ thuật: phần **trả phí** của họ là Azure voice + LLM dịch + backend proxy. Pipeline miễn phí tương đương hoàn toàn khả thi, chỉ đổi nhà cung cấp từng khâu.

## Decisions (đã chốt)

1. **Ngôn ngữ đích: chỉ tiếng Việt (`vi-VN`).** Không có bộ chọn ngôn ngữ ở bản đầu; hằng số trong `lib/config.ts`.
2. **Phân phối: load unpacked.** Không có task Chrome Web Store, không phí 5 USD, không review.
3. **TTS: Google `translate_tts` là chính, `speechSynthesis` là dự phòng.** Trừu tượng `TtsProvider`; `GoogleTtsProvider` (HTTP GET, miễn phí, không key) là chính; `SystemTtsProvider` tự chuyển khi provider chính lỗi 2 lần liên tiếp. Edge TTS bị loại vì trả 403 ở tầng upgrade — xem kết quả Task 1.
4. **Không server.** Toàn bộ dịch và TTS chạy client.
5. **Cache theo hash văn bản.** Key `sha256(voice + text)` trong IndexedDB, tái dùng giữa các video.
6. **Đồng bộ theo `duration` gốc, hiệu chuẩn theo `AudioContext.currentTime`,** không dùng `currentTime` tuyệt đối.
7. **Hạ âm lượng gốc bằng gain, không `muted=true`,** để giữ tuỳ chọn nghe nền.
8. Không dùng `webRequest`/`declarativeNetRequest`.
9. **Chỉ chạy trên YouTube web**: `matches` = `*://www.youtube.com/*`, `host_permissions` chỉ `www.youtube.com` + `translate.googleapis.com`, và content script tự kiểm `location.hostname === "www.youtube.com"`. Không hỗ trợ `m.youtube.com`, embed, hay site khác.

## Scope và ranh giới

Làm:
- Cài đặt độc lập từ đầu, dựa trên quan sát định dạng dữ liệu và hành vi.
- Dùng API công khai/miễn phí: caption của YouTube, Google Translate (endpoint công khai), Edge TTS, `speechSynthesis`.

Không làm:
- Không chép code, asset, icon, tên, chuỗi i18n, hay CSS của họ.
- Không gọi `yd.transduck.com`, không mang theo token/JWT của họ.
- Không vượt kiểm tra thành viên, không giả lập quyền trả phí.
- Không đóng gói lại extension của họ để phát hành.

Lưu ý: tự lồng tiếng để xem cá nhân nằm trong vùng xám điều khoản YouTube; không phân phối lại nội dung đã dịch, không thu tiền.

## Dependency graph

```
Manifest + build (2)
   └── Caption acquisition (3)
          └── Segmentation (4)
                 ├── Translation (5)
                 └── TTS + cache (6)   <-- spike rủi ro cao nhất (1), chạy trước
                        └── Playback + sync (7)
                               ├── Overlay + settings UI (8)
                               └── Prefetch + perf (9)
                                        └── Packaging + docs (10)
```

## Task list

### Phase 0: Spike (làm trước mọi thứ)

**Task 1: Chọn engine TTS — ĐÃ XONG (spike)**

Kết quả đo thật trên máy này (script trong `yt-dub-free/spike/`):

- **Edge TTS: THẤT BẠI.** `403` ở tầng WebSocket upgrade với cả `api.msedgeservices.com/tts/cognitiveservices/websocket/v1` và `speech.platform.bing.com/.../edge/v1`. Đã gửi đúng `Sec-MS-GEC` (BigInt, ticks 100 ns, làm tròn 5 phút) và đủ header giống Edge 143; thử 2 host × 4 version × 3 độ lệch đồng hồ — tất cả 403. Thư viện `msedge-tts` và `edge-tts-universal` cũng fail (đóng stream / treo). Kết luận: chặn từ môi trường, không phải lỗi code.
- **Google `translate_tts`: THÀNH CÔNG.** Một câu tiếng Việt trả `43 200` byte MP3, magic `ff f3`, không cần key, không cần đăng nhập, không cần Referer.
- Giới hạn đã biết: ~200 ký tự mỗi request (khớp câu ≤ 120 ký tự của Task 4), không SLA, dễ throttle theo IP.

Quyết định: `GoogleTtsProvider` là chính, `SystemTtsProvider` (`speechSynthesis`) là dự phòng. Bỏ hẳn nhánh Edge TTS và offscreen document.

Tiêu chí:
- [x] Có MP3 > 0 byte, magic hợp lệ, tiếng Việt
- [x] Không cần key, không cần server
- [ ] Trong extension: fetch + phát MP3, đo độ trễ (gộp vào Task 6)

**File:** `lib/tts/google.ts`, `lib/tts/provider.ts`, `lib/tts/system.ts`. Scope: S (3 file).

### Phase 1: Foundation

**Task 2: Scaffold extension build được**

- Mô tả: Khởi tạo WXT + TS, manifest MV3 tối thiểu, content script chèn badge vào `youtube.com/watch`.
- Tiêu chí:
  - [ ] `pnpm build` ra `.output/chrome-mv3`.
  - [ ] Load unpacked được, không lỗi manifest.
  - [ ] Badge hiện trên trang watch, không phá layout player.
- Kiểm chứng: `pnpm build`, load unpacked, mở 1 video.
- Phụ thuộc: None. **File:** `wxt.config.ts`, `entrypoints/content.ts`, `package.json`. Scope: S.

**Checkpoint A**
- [ ] Build chạy, badge hiện
- [ ] Task 1 xong, chốt provider TTS chính

**Task 3: Lấy caption của video — MỘT PHẦN (parser xong, nguồn text bị chặn)**

Đã làm và đã kiểm:
- [x] Liệt kê caption track từ `ytInitialPlayerResponse` (đọc script trong DOM, fallback tải trang). Trên máy này: `dQw4w9WgXcQ` = 6 track, `jNQXAC9IVRw` = 2 track, `aqz-KE-bpKQ` = 0 track + lỗi `"video không có caption"` (không crash). Kiểm bằng Edge headless + đọc `data-ytdubfree`.
- [x] `pickTrack`: ưu tiên track người tạo khớp `en` → asr khớp `en` → track người tạo bất kỳ → track đầu.
- [x] Parser `json3` (`events[].segs[].utf8`, bỏ `aAppend`, `tStartMs`, `dDurationMs`) và `parseVtt` (có/không có giờ, bỏ thẻ `<c>`, giải mã entity).
- [x] `normalizeCues`: sắp xếp, bỏ cue rỗng, ép `end > start`, cắt chồng lấn.
- [x] `tsc --noEmit` sạch, `node --test tests` = 8/8 pass.

Chặn (bằng chứng thật):
- `timedtext` (cả `fmt=json3` và `fmt=vtt`) trả **HTTP 200 + 0 byte** — cả từ Node lẫn **từ trong trang YouTube thật** qua CDP. URL có `exp=xpe` → YouTube đòi PO token.
- `youtubei/v1/get_transcript` trả `400 FAILED_PRECONDITION` dù đã gửi `params` lấy từ `getTranscriptEndpoint`, `INNERTUBE_API_KEY`, `visitorData`, kèm header `X-Goog-Visitor-Id`.
- Panel transcript trong DOM: không có `#description`, `ytd-transcript-renderer`, `ytd-transcript-segment-renderer` trong phiên headless → selector chưa kiểm chứng được.

Đã dựng sẵn `lib/youtube/transcriptDom.ts` (mở description → "Show transcript" → đọc `.segment-timestamp` + `.segment-text`), và nối fallback trong `fetchAndPublishCues`: `timedtext` → `transcript-panel`. Chưa nghiệm thu được vì cả hai nguồn đều không trả dữ liệu trong môi trường test.

Việc còn lại (chọn 1): (a) InnerTube `player` với client `ANDROID`/`IOS` để lấy `baseUrl` kèm `pot`; (b) tự sinh PO token qua BotGuard; (c) xác nhận `transcriptDom` trên Chrome/Edge thật của người dùng.

Đã thử (a): `youtubei/v1/player` với client `ANDROID 19.44.38` và `IOS 19.45.4` → **cả hai đều `400 Precondition check failed`**, cùng body y như `get_transcript`. Ba endpoint khác nhau, hai client khác nhau, cùng một lỗi ⇒ chặn theo IP/môi trường mạng của máy này, không phải thiếu field. Vì `GET` trang watch vẫn trả 200 và có `captionTracks`, còn mọi `POST` InnerTube đều bị `FAILED_PRECONDITION`, kết luận: **không thể nghiệm thu caption text trên máy này**; phải xác nhận trên trình duyệt thật của người dùng.

**File:** `lib/youtube/innertube.ts`, `lib/youtube/captions.ts`, `lib/youtube/transcriptDom.ts`, `lib/subtitle/parse.ts`, `lib/subtitle/types.ts`, `tests/parse.test.mjs`, `scripts/e2e-captions.mjs`. Scope: M.

**Task 4: Cắt câu (segmentation) — XONG**

Đã làm:
- [x] Gộp mảnh caption thành câu: cắt khi gặp dấu kết `. ! ? 。 ！ ？ …` (kèm ngoặc/nháy), khi khoảng lặng ≥ 0.15 s, khi vượt 120 ký tự hoặc 15 s.
- [x] Tách câu quá dài: ngân sách ký tự = `min(120, maxDuration × ký tự/giây)`, cắt ở khoảng trắng hoặc dấu `, ; : 、`; thời gian chia theo tỉ lệ ký tự.
- [x] Gộp câu rời: chỉ gộp khi còn chỗ ký tự, còn chỗ thời lượng, khoảng lặng < 0.15 s và câu trước chưa kết thúc.
- [x] Bất biến kiểm tự động: không cue rỗng, ≤ 120 ký tự, ≤ 15 s, `end > start`, thứ tự thời gian tăng.

Kiểm chứng: `node --test tests` → **19/19 pass** (11 test segmentation + 8 test parser). `tsc --noEmit` sạch, build 13.29 kB.

Bug tìm thấy khi test (đã sửa): (1) bước gộp câu rời nuốt mất chỗ cắt do khoảng lặng; (2) ngân sách ký tự khi tách theo thời lượng tính sai nên sinh cue 18 s; (3) một kỳ vọng trong test của tôi sai (fixture đúng là 3 câu, không phải 4).

Ghi chú: fixture tổng hợp theo kiểu auto-caption, **không phải caption thật** vì mạng máy này không tải được caption. Cần chạy lại trên caption thật khi có (Task 3b).

Nối vào extension: `fetchAndPublishCues` giờ báo thêm `segments` (số câu sau cắt) cạnh `cues` trong `data-ytdubfree`.

**File:** `lib/subtitle/segment.ts`, `tests/segment.test.mjs`, `entrypoints/content.ts`. Scope: M.

### Phase 2: Core pipeline

**Task 5: Dịch sang tiếng Việt — XONG**

Đã làm:
- [x] `buildTranslateUrl` gọi `translate.googleapis.com/translate_a/single` (`client=gtx`, `sl=auto`, `tl=vi`, `dt=t`), không key, không server.
- [x] `parseGoogleResponse` ghép các mảnh `payload[0][i][0]` đúng thứ tự câu.
- [x] `translateBatch`: giới hạn song song (mặc định 3), retry có backoff `300 ms × 2^i`, câu rỗng không gọi mạng, giữ đúng thứ tự 1-1.
- [x] Cache: `TranslationCache` injectable + `translationCache` IndexedDB thật (`lib/cache/idb.ts`), `hashText` SHA-256.
- [x] `splitForTranslation` chia câu > 4000 ký tự, không mất chữ.

Kiểm chứng:
- `node --test tests` → **27/27 pass** (8 test dịch + 8 parser + 11 segmentation).
- Gọi endpoint thật: 5 câu Anh → Việt, **614 ms**, 5 request; chạy lần hai **0 request, 0 ms**, kết quả giống hệt.
- `tsc --noEmit` sạch, build 13.33 kB.

Ghi chú chất lượng: Google `gtx` dịch đúng nghĩa nhưng khá máy móc, ví dụ "The pipeline reads captions, translates them, and speaks them." → "Quy trình đọc chú thích, dịch và đọc chú thích." Chấp nhận cho bản miễn phí; Task 6 ghép TTS nên chỉ cần nghĩa đúng.

**File:** `lib/translate/google.ts`, `lib/cache/idb.ts`, `tests/translate.test.mjs`, `scripts/probe-translate.mjs`. Scope: M.

**Task 6: TTS + cache audio — XONG**

- [x] `GoogleTtsProvider`: `translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi`, cắt câu theo `TTS_MAX_CHARS = 190` ở khoảng trắng, ghép các mảnh MP3.
- [x] `SystemTtsProvider`: `speechSynthesis`, tự chọn voice `vi-VN`, `speak()` / `cancel()`.
- [x] `TtsQueue`: song song 3, giữ thứ tự, `cancel()`, đọc cache trước khi gọi mạng, mỗi câu lỗi được đọc ngay bằng dự phòng, sau 2 lỗi liên tiếp thì ngừng gọi provider chính.
- [x] `audioCache` IndexedDB (DB version 2, store `audio`) lưu bytes theo khoá `lang|text`.
- [x] Manifest thêm host `https://translate.google.com/*`.

Kiểm chứng:
- `node --test tests` → **36/36 pass** (9 test TTS + 8 dịch + 8 parser + 11 segmentation).
- Endpoint thật: 1 câu = **34 944 byte**, head `ff f3 84 c4`, **395 ms**.
- Hàng đợi 3 câu: run1 **225 ms**, 3 request, kích thước `34944,27648,24576`, peak song song **3**; run2 **0 ms, 0 request**, tất cả `fromCache=true`.
- `tsc --noEmit` sạch, build 13.75 kB.

Ghi chú: câu > 190 ký tự bị chia nhiều request rồi nối MP3 frame; phát được nhưng có thể có 1 tick nhỏ ở điểm nối — Task 7 kiểm bằng tai khi phát.

**File:** `lib/tts/provider.ts`, `lib/tts/google.ts`, `lib/tts/system.ts`, `lib/tts/queue.ts`, `lib/cache/audioCache.ts`, `tests/tts.test.mjs`, `scripts/probe-tts.mjs`. Scope: M.

**Checkpoint B** (quan trọng nhất)
- [ ] Video 2 phút phát tiếng Việt liên tục
- [ ] Phát lại không gọi mạng
- [ ] Đổi video 3 lần không rò rỉ bộ nhớ

**Task 7: Playback engine + sync**

- Mô tả: Phát audio theo cue; xử lý play/pause/seek/rate/ended; hạ âm lượng gốc bằng gain.
- Tiêu chí:
  - [ ] Seek giữa video phát đúng câu tại mốc đó.
  - [ ] Lệch < 300 ms sau 10 seek liên tiếp.
  - [ ] Đổi tốc độ 0.5x/1x/1.5x không trôi tiếng.
  - [ ] Người dùng pause thì audio dịch cũng dừng.
- Kiểm chứng: kịch bản tay 10 bước trên 1 video; log độ lệch.
- Phụ thuộc: 6. **File:** `lib/player/engine.ts`, `lib/player/sync.ts`. Scope: M.

### Phase 3: UI + hoàn thiện

**Task 8: Overlay phụ đề + popup cài đặt — XONG**

- [x] `lib/settings.ts`: `chrome.storage.sync`, mặc định `{enabled:false, originalVolume:0.1, dubVolume:1}`, `normalizeSettings` kẹp `[0,1]`, bỏ giá trị rác.
- [x] `lib/ui/overlay.ts`: `<div>` phụ đề trong `.html5-video-container`, absolute `bottom:12%`, `pointer-events:none`, không che control bar; `setText/clear/destroy`.
- [x] `entrypoints/popup/*`: 2 slider (tiếng gốc / tiếng lồng) + checkbox "Tự bật khi mở video", lưu ngay khi đổi.
- [x] `entrypoints/background.ts`: `browser.commands.onCommand` → `tabs.sendMessage` tới tab đang active; manifest khai báo `toggle-dubbing` = `Alt+D`.
- [x] Content script: nhận message `ytdubfree:toggle`, có fallback `keydown Alt+D`, nghe `storage.onChanged` để đổi âm lượng ngay khi đang phát, `SubtitleOverlay` cập nhật theo `onDecision`.
- [x] Không có ô chọn ngôn ngữ (cố định `vi`).

Kiểm chứng:
- `node --test tests` → **51/51 pass** (4 test settings).
- `tsc --noEmit` sạch; build ra `popup.html`, `background.js`, `content.js`, `popup.css`, tổng **32.94 kB**.
- Manifest build ra: `commands.toggle-dubbing.suggested_key.default = Alt+D`, `action.default_popup = popup.html`, `background.service_worker = background.js`, description tiếng Việt đúng UTF-8.
- Smoke test trên Edge headless (`scripts/smoke-extension.mjs`) → **SMOKE OK**: badge mount, shadow button có, `dataset.ytdubfree.settings = {"enabled":false,"originalVolume":0.1,"dubVolume":1}`, overlay **không** tạo khi chưa bật.

**File:** `lib/settings.ts`, `lib/ui/overlay.ts`, `entrypoints/background.ts`, `entrypoints/popup/*`, `entrypoints/content.ts`, `tests/settings.test.mjs`, `scripts/smoke-extension.mjs`. Scope: M.

**Task 9: Prefetch + độ mượt — XONG (phần đo thời gian chờ browser thật)**

- [x] `lib/player/prefetch.ts`: `PrefetchController` nhìn trước 4 câu, **tuần tự 1 request**, bỏ qua câu đã có audio, không lặp câu đã xếp, câu lỗi không chặn câu sau, `cancel()`, `setPaused()`.
- [x] Ghi thẳng vào `audioByIndex` mà `DubEngine` đang dùng → engine thấy audio mới ở tick kế tiếp, không phải khởi động lại.
- [x] Nối content script: `onDecision` → `ensureFrom(index + 1)`; `visibilitychange` → `setPaused(document.hidden)`; tắt dubbing → `cancel()`.
- [x] Audio prefetch ghi vào `audioCache` (`lang|text`) nên lần sau phát lại không cần mạng.

Kiểm chứng:
- `node --test tests` → **58/58 pass** (7 test prefetch: lookahead/dedup, bỏ câu đã có, tuần tự `peak=1`, cancel, câu lỗi không chặn, pause/resume, biên).
- `tsc --noEmit` sạch; build **33.99 kB**.

Chưa đo được: "bắt đầu phát < 1.5 s" và "không khoảng lặng > 0.3 s" — cần caption thật + mạng thật (Task 3b).

**File:** `lib/player/prefetch.ts`, `entrypoints/content.ts`, `tests/prefetch.test.mjs`. Scope: S.

**Task 10: Đóng gói + tài liệu — XONG**

- [x] Icon PNG tự sinh (`scripts/make-icons.mjs`, tự viết PNG encoder bằng `zlib`), 4 kích thước 16/32/48/128, nền xanh + tam giác phát.
- [x] `README.md`: giới thiệu, yêu cầu, build, 5 bước load unpacked, dùng `Alt+D`, cách hoạt động, quyền/dữ liệu, phát triển, giới hạn, ghi chú pháp lý.
- [x] Ảnh thật: `docs/popup.png` chụp từ extension đang chạy bằng CDP (`scripts/capture-popup.mjs`), 496×327.
- [x] `npm run test|compile|build|zip|icons|smoke` đều có script.
- [x] Không có asset/chuỗi/thương hiệu của extension gốc; không có bước Chrome Web Store.

Kiểm chứng:
- `npm test` → **58/58 pass**; `npm run compile` → sạch.
- `npm run zip` → `.output/yt-dub-free-0.1.0-chrome.zip`, **14.94 kB**, 10 entry: `manifest.json`, `background.js`, `content-scripts/content.js` (28 533 B), `popup.html`, `assets/popup-*.css`, `chunks/popup-*.js`, `icon/16|32|48|128.png`.
- `npm run build` → `.output/chrome-mv3`, tổng **35.06 kB**.
- Manifest có `icons` trỏ 4 PNG, `action.default_popup`, `commands.toggle-dubbing`, `background.service_worker`.

**File:** `README.md`, `docs/popup.png`, `public/icon/*.png`, `scripts/make-icons.mjs`, `scripts/capture-popup.mjs`, `package.json`. Scope: S.

### Checkpoint cuối
- [x] Mọi acceptance criteria của Task 1, 2, 4, 5, 6, 7, 8, 9, 10 đạt (có test/smoke đo được)
- [ ] Task 3 (caption text) + Checkpoint B (nghe thật trên video 2 phút) — chặn bởi mạng máy này, chờ Task 3b trên trình duyệt thật của người dùng
- [x] Không phụ thuộc backend trả phí nào
- [x] Chi phí chạy: 0

## Lỗi tồn đọng đã sửa (trước Task 9)

1. **IndexedDB đụng version**: `lib/cache/idb.ts` mở DB version 1, `lib/cache/audioCache.ts` mở version 2 → mở sau sẽ ném `VersionError`. Gộp về `lib/cache/db.ts`: một `DB_VERSION = 2`, tạo cả store `translations` và `audio` trong cùng một lần upgrade.
2. **SPA làm mất phiên lồng tiếng**: `sync()` chạy lại mỗi `yt-navigate-finish` (đổi chất lượng, đổi param) nên dừng dubbing giữa chừng. Sửa: cùng `videoId` và đang bật thì bỏ qua; khác video mới `stopDubbing()`.
3. **Harness cũ sai sau khi nối pipeline**: `scripts/e2e-captions.mjs` bấm badge rồi chờ `cues`, nhưng badge giờ chạy cả pipeline nên không còn ý nghĩa. Đổi thành harness chỉ đọc caption track; badge/overlay/settings đã có `scripts/smoke-extension.mjs` lo.

## Risks and mitigations

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Google `translate_tts` throttle/chặn theo IP | Cao | Cache mạnh, giãn nhịp, retry backoff, tự chuyển `speechSynthesis`; prefetch sớm để phát mượt |
| Voice tiếng Việt của `speechSynthesis` không có trên máy | Thấp | Kiểm tra `getVoices()` lúc khởi động; nếu rỗng thì báo người dùng, vẫn phát bằng Google TTS |
| Voice `vi-VN` không có trong danh sách free | Trung | Task 1 liệt kê voice `vi-VN` thực tế; nếu thiếu thì dùng `speechSynthesis` tiếng Việt |
| YouTube chặn `timedtext` bằng PO token (`exp=xpe`) | Cao | Đang chặn Task 3. Phương án: client `ANDROID`/`IOS` lấy `baseUrl` có `pot`, hoặc `transcriptDom` trên trình duyệt thật, hoặc ASR |
| Video không có caption | Cao | Thông báo rõ; ASR WASM để giai đoạn sau, ngoài scope bản đầu |
| Google Translate chặn khi gọi nhiều | Trung | Batch nhỏ, giãn nhịp, cache mạnh, endpoint dự phòng |
| MV3 kill offscreen document | Trung | Tạo lại theo nhu cầu, lưu trạng thái vào `chrome.storage.session` |
| Trôi đồng bộ khi seek nhiều | Trung | Test lệch < 300 ms; hiệu chuẩn theo `AudioContext.currentTime` |
| Vi phạm điều khoản/ToS | Trung | Chỉ dùng cá nhân, không phân phối nội dung dịch, không thu tiền |
| Cache audio phình bộ nhớ | Thấp | LRU, đo ở Task 6 |

## Nguyên tắc làm việc

- Mỗi task là một nhánh công việc độc lập, ≤ 5 file, verify bằng test + chạy tay.
- Không bắt đầu task sau khi checkpoint trước chưa đạt.
- Mọi hành vi lấy từ quan sát của bản clone, không copy từ bundle của họ.
