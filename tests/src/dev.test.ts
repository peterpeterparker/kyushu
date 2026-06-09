import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn } from "./utils/cmd.utils";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { waitForServer } from "./utils/server.utils";
import { writeFile, rm } from "fs/promises";
import { join } from "node:path";

const PORT = 5988;
const BASE_URL = `http://localhost:${PORT}`;
const CONFIG = "fixtures/dev/kyushu.toml";
const KYU = `../target/${__KYU_BUILD__}/kyu`;

const TEMPLATE = `export default {
    async fetch() {
        return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hello: "{{value}}" }),
        };
    },
};`;

const TEST_FILE = join(process.cwd(), "fixtures", "dev", "tmp.ts");

describe("dev", { concurrent: false }, () => {
  let runner: ChildProcessWithoutNullStreams;

  beforeAll(async () => {
    await writeFile(TEST_FILE, TEMPLATE.replace("{{value}}", "world"));

    runner = await spawn({ command: KYU, args: ["dev", CONFIG] });
    await waitForServer({ port: PORT });
  }, 120_000);

  afterAll(async () => {
    runner?.kill();

    await rm(TEST_FILE, { force: true });
  });

  it("returns 200 with initial implementation", async () => {
    const response = await fetch(BASE_URL);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ hello: "world" });
  });

  it("returns 200 with updated implementation after hot reload", async () => {
    await writeFile(TEST_FILE, TEMPLATE.replace("{{value}}", "updated"));

    await vi.waitFor(
      async () => {
        const response = await fetch(BASE_URL);
        const body = await response.json();
        expect(body).toEqual({ hello: "updated" });
      },
      { timeout: 30_000 },
    );
  }, 30_000);
});
