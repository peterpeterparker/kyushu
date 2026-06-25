import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch(request, env) {
    console.log(request, env);

    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler;
