import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execute, spawn } from "./utils/cmd.utils";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { waitForServer } from "./utils/server.utils";

const PORT = 5987;
const BASE_URL = `http://localhost:${PORT}`;
const CONFIG = "fixtures/env/kyushu.toml";
const KYU = `../target/${__KYU_BUILD__}/kyu`;

describe("env", () => {
  let runner: ChildProcessWithoutNullStreams;

  beforeAll(async () => {
    await execute({ command: KYU, args: ["build", CONFIG] });

    runner = await spawn({ command: KYU, args: ["run", CONFIG] });

    await waitForServer({ port: PORT });
  }, 120_000);

  afterAll(() => {
    runner?.kill();
  });

  it("returns 200 with the API_KEY env var in the response", async () => {
    const response = await fetch(BASE_URL);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({ secret: "secret" });
  });
});
