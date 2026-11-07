import { browser } from "wxt/browser";

const TOGGLE_COMMAND = "toggle-dubbing";

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command !== TOGGLE_COMMAND) return;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs[0];
        if (tab?.id === undefined) return;
        return browser.tabs.sendMessage(tab.id, { type: "ytdubfree:toggle" });
      })
      .catch(() => {
        // tab không có content script (không phải youtube.com) — bỏ qua
      });
  });
});
