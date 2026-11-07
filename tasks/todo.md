# Todo: YouTube dubbing extension miễn phí (Chrome MV3)

Chốt: tiếng Việt (`vi-VN`) · load unpacked · fallback `speechSynthesis` · chi phí 0.

## Phase 0: Spike — XONG
- [x] Task 1: chọn engine TTS. Edge TTS trả 403 (bị chặn), Google `translate_tts` OK (43 200 byte MP3). Chốt `GoogleTtsProvider` + fallback `speechSynthesis`
- [ ] Task 1b: `SystemTtsProvider` phát cùng câu qua `speechSynthesis` (làm trong Task 6)

## Phase 1: Foundation
- [x] Task 2: Scaffold WXT 0.21.5 + MV3, `npm run build` ra `.output/chrome-mv3`, badge hiện trên YouTube (đã kiểm headless Edge: badge có ở `/watch`, không có ở trang chủ, `tsc --noEmit` pass)
- [ ] Task 3: Lấy + parse caption. **Một phần**: parser `json3`/VTT + `pickTrack` + `normalizeCues` xong, 8/8 unit test pass, track enumeration đúng trên 3 video. **Chặn**: `timedtext` trả 200 + 0 byte (PO token `exp=xpe`), `get_transcript` 400, `player` client ANDROID/IOS cũng 400 `FAILED_PRECONDITION` → chặn theo mạng máy này
- [ ] Task 3b (cần người dùng): xác nhận caption text trên Edge/Chrome thật. Mở video → click badge → xem `document.documentElement.dataset.ytdubfree`
- [x] Task 4: Segmentation theo dấu câu + khoảng lặng 0.15 s + tách câu dài. 11 test, tổng 19/19 pass

### Checkpoint A
- [ ] Build chạy, badge hiện
- [ ] Chốt provider TTS chính

## Phase 2: Core pipeline
- [x] Task 5: Dịch sang `vi`, batch song song 3, retry backoff, cache IndexedDB. 8 test, tổng 27/27 pass. Endpoint thật: 5 câu = 614 ms, chạy lại 0 request
- [x] Task 6: TTS + cache audio IndexedDB, hàng đợi 3 luồng, tự chuyển provider. 9 test, tổng 36/36 pass. Thật: 1 câu 34 944 byte/395 ms; run2 0 request
- [ ] Task 7: Playback engine + sync (seek, rate, pause)

### Checkpoint B
- [ ] Video 2 phút phát tiếng Việt liên tục
- [ ] Phát lại không gọi mạng
- [ ] Đổi video 3 lần không rò rỉ bộ nhớ

## Phase 3: UI + hoàn thiện
- [x] Task 8: Overlay phụ đề + popup cài đặt + hotkey `Alt+D`. 4 test settings (tổng 51/51), smoke Edge: SMOKE OK, manifest có popup/background/commands
- [x] Task 9: Prefetch, lookahead 4, tuần tự, pause khi tab ẩn, ghi cache audio. 7 test, tổng 58/58 pass
- [x] Task 10: Icon PNG, README load unpacked có ảnh popup thật, `npm run zip` ra 14.94 kB. 58/58 test, tsc sạch

### Checkpoint cuối
- [x] Task 1,2,4,5,6,7,8,9,10 đạt
- [ ] Task 3b: xác nhận caption thật + nghe thử trên Edge/Chrome thật (chờ người dùng)
- [x] Không backend trả phí, chi phí 0
