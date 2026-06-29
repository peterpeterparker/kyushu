import type { ExportedHandler } from "kyushu-types";

/**
 * TEST ME:
 * ❯ curl http://localhost:5987/hello.txt
 * Hello world from memory!
 * ❯ curl http://localhost:5987/static/hello.txt
 * Hello world from mounted FS!
 */
export default {
  async fetch(request, env) {
    const responseFromMemory = await env.ASSETS.fetch(request);

    if (responseFromMemory.status !== 404) {
      return responseFromMemory;
    }

    return await env.ASSETS.fetch(request, { src: "mount" });
  },
} satisfies ExportedHandler;
