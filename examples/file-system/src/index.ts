import type { ExportedHandler } from "kyushu-types";
import { writeFileSync, readFileSync } from "node:fs";

export default {
  async fetch() {
    writeFileSync("/hello.txt", "Hello from Kyushu!");
    const content = readFileSync("/hello.txt", "utf8");

    return {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: content,
    };
  },
} satisfies ExportedHandler;
