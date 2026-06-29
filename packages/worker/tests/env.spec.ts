import { buildEnv } from "../src/env";
import { fetch } from "../src/assets/handler";

describe("buildEnv", () => {
  it("returns ASSETS with fetch", () => {
    const env = buildEnv();
    expect(env.ASSETS).toBeDefined();
    expect(env.ASSETS.fetch).toBe(fetch);
  });
});
