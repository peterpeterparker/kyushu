import { fetchFromMemory as fetch } from "../../src/assets/_fetch-memory";

const mockAssets: Record<string, WorkerAsset> = {};

vi.stubGlobal("__kyushu_get_asset__", (path: string) => mockAssets[path]);

const setAsset = (path: string, content: string, mimeType?: string) => {
  mockAssets[path] = {
    bytes: new TextEncoder().encode(content),
    mimeType,
  };
};

afterEach(() => {
  Object.keys(mockAssets).forEach((k) => delete mockAssets[k]);
});

describe("_fetch-memory", () => {
  it("returns 405 for non-GET/HEAD methods", async () => {
    const res = await fetch({ method: "POST", url: "http://localhost/" });
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid URL", async () => {
    const res = await fetch({ method: "GET", url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when asset not found", async () => {
    const res = await fetch({ method: "GET", url: "http://localhost/missing.html" });
    expect(res.status).toBe(404);
  });

  it("returns 200 with asset bytes", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/index.html" });
    expect(res.status).toBe(200);
    expect(res.headers?.["content-type"]).toBe("text/html");
  });

  it("resolves / to /index.html", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/" });
    expect(res.status).toBe(200);
  });

  it("resolves /about to /about.html", async () => {
    setAsset("/about.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/about" });
    expect(res.status).toBe(200);
  });

  it("resolves /about to /about/index.html", async () => {
    setAsset("/about/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/about" });
    expect(res.status).toBe(200);
  });

  it("returns HEAD response without body", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "HEAD", url: "http://localhost/index.html" });
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
  });

  it("returns 304 when etag matches", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res1 = await fetch({ method: "GET", url: "http://localhost/index.html" });
    const etag = res1.headers?.["etag"];
    const res2 = await fetch({
      method: "GET",
      url: "http://localhost/index.html",
      headers: { "if-none-match": etag! },
    });
    expect(res2.status).toBe(304);
  });

  it("returns security headers", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/index.html" });
    expect(res.headers?.["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers?.["X-Frame-Options"]).toBe("DENY");
  });

  it("returns cache headers for .js files", async () => {
    setAsset("/app.js", "console.log(1)", "text/javascript");
    const res = await fetch({ method: "GET", url: "http://localhost/app.js" });
    expect(res.headers?.["cache-control"]).toContain("immutable");
  });

  it("serves brotli compressed asset when accepted", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    setAsset("/index.html.br", "compressed", undefined);
    const res = await fetch({
      method: "GET",
      url: "http://localhost/index.html",
      headers: { "accept-encoding": "br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers?.["content-encoding"]).toBe("br");
    expect(res.headers?.["content-type"]).toBe("text/html");
  });

  it("serves gzip compressed asset when accepted", async () => {
    mockAssets["/index.html"] = {
      bytes: new TextEncoder().encode("<html></html>"),
      mimeType: "text/html",
    };
    mockAssets["/index.html.gz"] = {
      bytes: new TextEncoder().encode("compressed"),
      mimeType: undefined,
    };
    const res = await fetch({
      method: "GET",
      url: "http://localhost/index.html",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers?.["content-encoding"]).toBe("gz");
    expect(res.headers?.["content-type"]).toBe("text/html");
  });

  it("falls back to uncompressed when br not accepted", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    setAsset("/index.html.br", "compressed", undefined);
    const res = await fetch({
      method: "GET",
      url: "http://localhost/index.html",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers?.["content-encoding"]).toBeUndefined();
  });

  it("uses application/octet-stream when no mime type", async () => {
    setAsset("/file.bin", "data");
    const res = await fetch({ method: "GET", url: "http://localhost/file.bin" });
    expect(res.headers?.["content-type"]).toBe("application/octet-stream");
  });

  it("returns last-modified header when available", async () => {
    mockAssets["/index.html"] = {
      bytes: new TextEncoder().encode("<html></html>"),
      mimeType: "text/html",
      lastModified: 1700000000,
    };
    const res = await fetch({ method: "GET", url: "http://localhost/index.html" });
    expect(res.headers?.["last-modified"]).toBe(new Date(1700000000 * 1000).toUTCString());
  });

  it("omits last-modified header when not available", async () => {
    setAsset("/index.html", "<html></html>", "text/html");
    const res = await fetch({ method: "GET", url: "http://localhost/index.html" });
    expect(res.headers?.["last-modified"]).toBeUndefined();
  });
});
