import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch() {
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    };
  },
} satisfies ExportedHandler;
