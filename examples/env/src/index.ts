import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch() {
    const apiKey = process.env.API_KEY;

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ API_KEY: apiKey }),
    };
  },
} satisfies ExportedHandler;
