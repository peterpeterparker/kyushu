import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch(request, env) {
    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler;
