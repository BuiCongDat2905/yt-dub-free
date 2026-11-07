import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "YT Dub Free",
    description: "Long tieng YouTube sang tieng Viet bang dich va TTS mien phi.",
    version: "0.1.0",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    permissions: ["storage", "activeTab", "scripting"],
    commands: {
      "toggle-dubbing": {
        suggested_key: { default: "Alt+D", mac: "Alt+D" },
        description: "Bật/tắt lồng tiếng",
      },
    },
    host_permissions: [
      "*://www.youtube.com/*",
      "https://translate.googleapis.com/*",
      "https://translate.google.com/*",
    ],
  },
});
