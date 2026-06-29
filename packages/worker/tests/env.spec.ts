import { buildEnv, notImplemented } from "../src/env";

describe("buildEnv", () => {
  it("returns ASSETS with notImplemented when no assets configured", () => {
    vi.stubGlobal("__kyushu_has_assets__", () => false);
    const env = buildEnv();
    expect(env.ASSETS).toBeDefined();
    expect(env.ASSETS.fetch).toBe(notImplemented);
  });

  it("returns ASSETS with fetch when assets configured", () => {
    vi.stubGlobal("__kyushu_has_assets__", () => true);
    vi.stubGlobal("__kyushu_get_asset__", () => undefined);
    const env = buildEnv();
    expect(env.ASSETS).toBeDefined();
    expect(typeof env.ASSETS.fetch).toBe("function");
    expect(env.ASSETS.fetch).not.toBe(notImplemented);
  });

  it("notImplemented returns 501", async () => {
    const response = await notImplemented();
    expect(response.status).toBe(501);
    expect(response.body).toBe("Not Implemented");
  });
});
