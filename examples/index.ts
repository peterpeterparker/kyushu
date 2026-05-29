import { writeFileSync, readFileSync } from "node:fs";
import type { WorkerRequest, ExportedHandler } from "../packages/types/src";

export default {
  async fetch(request: WorkerRequest) {
    console.log("Request received:", request.method, request.url);

    console.log("Symbol.dispose:", typeof Symbol.dispose);
    console.log("Symbol.asyncDispose:", typeof Symbol.asyncDispose);

    console.log("ENV->", process.env.API_KEY);

    // Write a file
    writeFileSync("./target/kyushu2.txt", "Hello from Kyushu, TypeScript bundled with Rolldown!");

    // Read it back
    const content = readFileSync("./target/kyushu2.txt", "utf8");

    // Fetch
    const dogResponse = await fetch("https://dog.ceo/api/breeds/image/random");

    if (!dogResponse.ok) {
      return {
        status: 500,
        body: "Cannot fetch random dog.",
      };
    }

    const { message } = await dogResponse.json();

    const dogImageResponse = await fetch(message);

    if (!dogImageResponse.ok) {
      return {
        status: 500,
        body: "Cannot fetch random dog image.",
      };
    }

    writeFileSync("./target/dog.jpg", await dogImageResponse.bytes());

    return {
      status: 200,
      body: JSON.stringify({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body ?? null,
        file: content,
      }),
      headers: { "content-type": "application/json" },
    };
  },
} satisfies ExportedHandler;
