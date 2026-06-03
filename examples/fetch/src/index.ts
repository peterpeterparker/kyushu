import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch() {
    const response = await fetch("https://dog.ceo/api/breeds/image/random");

    if (!response.ok) {
      return { status: 502, body: "Upstream request failed." };
    }

    const data = await response.json();

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    };
  },
} satisfies ExportedHandler;
