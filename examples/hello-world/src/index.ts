import type { ExportedHandler } from "kyushu-types";
import { writeFileSync, readFileSync } from "node:fs";

export default {
  async fetch(request, env) {
    writeFileSync("/hello.txt", "Hello from Kyushu!");
    const content = readFileSync("/hello.txt", "utf8");

    console.log(request, env);

    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler;
