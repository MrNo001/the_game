import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    // The page connects to the game server through this dev server (at /ws),
    // so a friend only needs one address to load the page and to play.
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
    // Allow pages opened through a Cloudflare tunnel link (see `npm run share`)
    allowedHosts: [".trycloudflare.com"],
  },
});
