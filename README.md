# YT Dub Free

Extension Chrome MV3 lồng tiếng video YouTube sang tiếng Việt, chạy hoàn toàn trong trình duyệt. Không server, không tài khoản, không API key, chi phí 0.

Repo: https://github.com/BuiCongDat2905/yt-dub-free

![Popup cài đặt](docs/popup.png)

## Tính năng

- Lấy caption/transcript của video YouTube, cắt thành câu dễ đọc.
- Dịch sang tiếng Việt bằng Google Translate công khai, có cache.
- Tổng hợp giọng đọc tiếng Việt bằng Google TTS, có cache audio.
- Phát audio lồng tiếng bám theo đồng hồ video: seek, pause, đổi tốc độ đều khớp.
- Hạ âm lượng tiếng gốc, hiện phụ đề tiếng Việt trên player.
- Hotkey `Alt+D`; popup chỉnh âm lượng gốc/lồng và tự bật khi mở video.
- Cache trong IndexedDB nên lần phát lại không gọi mạng.

Chỉ chạy trên `www.youtube.com`. Không hỗ trợ `m.youtube.com`, video nhúng, hay site khác.

## Yêu cầu

- Trình duyệt Chrome hoặc Edge (bản mới, hỗ trợ MV3).
- Video có caption hoặc transcript. Video không có thì extension báo lỗi rõ, không treo.
- Để build: Node.js 22.x (>= 22.23.4), 24.x (>= 24.22.1) hoặc >= 26.12.1; npm.

## Build

```bash
npm install
npm run build
```

Kết quả ở `.output/chrome-mv3`. Muốn file đóng gói: `npm run zip` → `.output/yt-dub-free-0.1.0-chrome.zip`.

## Cài đặt (load unpacked)

1. Mở `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode**.
3. Bấm **Load unpacked**.
4. Chọn thư mục `D:\Ai20K\yt-dub-free\.output\chrome-mv3`.
5. Mở một video YouTube, bấm badge **Dub: OFF** ở góc phải dưới player (hoặc `Alt+D`).

Với Edge, bản build sẵn đã được copy vào `C:\Users\datco\EdgeExtensions\yt-dub-free` — chọn đúng thư mục đó khi bấm **Load unpacked** để extension không phụ thuộc thư mục `.output`.

Lần đầu sẽ mất vài giây để lấy caption, dịch và tổng hợp giọng. Badge chuyển **Dub: ON** khi audio bắt đầu phát.

![Popup cài đặt](docs/popup.png)

## Dùng

- `Alt+D`: bật/tắt lồng tiếng.
- Badge dưới player: trạng thái `OFF` / `Đang chuẩn bị…` / `ON`.
- Popup: kéo **Tiếng gốc** (mặc định `0.10`) và **Tiếng lồng** (`1.00`), tick **Tự bật khi mở video**.

## Cách hoạt động

```
caption/transcript → cắt câu → dịch VI → TTS → phát theo cue
```

- Đồng hồ duy nhất là `video.currentTime`; audio chỉ là đầu ra, nên seek/đổi tốc độ không trôi.
- Lệch quá 0.2 s thì tua lại audio; ngưỡng này nhỏ hơn 0.3 s theo yêu cầu.
- Prefetch 4 câu phía trước, tuần tự, dừng khi tab ẩn.
- Google TTS lỗi thì tự chuyển `speechSynthesis` của máy cho câu đó.

## Quyền và dữ liệu

- `storage`: lưu cài đặt (`chrome.storage.sync`) và cache (IndexedDB).
- Host: `www.youtube.com` (đọc trang/caption), `translate.googleapis.com` (dịch), `translate.google.com` (TTS).
- Audio TTS tải qua **background service worker** rồi chuyển sang content script. Lý do: `translate.google.com/translate_tts` không trả header `Access-Control-Allow-Origin`, nên fetch trực tiếp từ content script bị CORS chặn.
- Không gửi dữ liệu tới server nào của dự án. Không thu thập telemetry.

## Phát triển

```bash
npm run build     # build extension
npm run compile   # tsc --noEmit
npm test          # node --test tests (58 test)
npm run zip       # đóng gói
npm run icons     # tạo lại icon PNG
npm run smoke     # smoke test extension bằng Edge headless
```

Endpoint miễn phí có thể bị giới hạn theo IP. Nếu TTS bắt đầu lỗi hàng loạt, extension tự chuyển sang giọng hệ điều hành.

## Giới hạn đã biết

- Chỉ tiếng Việt; không có bộ chọn ngôn ngữ.
- Chất lượng dịch của Google `gtx` đúng nghĩa nhưng máy móc.
- Câu > 190 ký tự bị chia nhiều request rồi nối MP3, có thể nghe 1 tick nhỏ ở điểm nối.
- Video không có caption/transcript thì không lồng tiếng được (chưa có ASR).

## Ghi chú pháp lý

Đây là bản cài đặt độc lập, viết từ quan sát hành vi và định dạng dữ liệu công khai. Không chứa mã nguồn, asset, icon, chuỗi i18n hay thương hiệu của extension nào khác. Không gọi backend trả phí và không vượt qua cơ chế kiểm tra thành viên.

Dùng cho mục đích cá nhân. Không phân phối lại nội dung đã dịch, không dùng cho mục đích thương mại.
