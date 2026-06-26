import { buildEnv } from "../src/env";

describe("buildEnv", () => {
  it("returns empty env when no assets configured", () => {
    vi.stubGlobal("__kyushu_has_assets__", () => false);
    expect(buildEnv()).toEqual({});
  });

  it("returns env with ASSETS when assets configured", () => {
    vi.stubGlobal("__kyushu_has_assets__", () => true);
    vi.stubGlobal("__kyushu_get_asset__", () => undefined);
    const env = buildEnv();
    expect(env.ASSETS).toBeDefined();
    expect(typeof env.ASSETS?.fetch).toBe("function");
  });
});
