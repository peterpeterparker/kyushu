import { fetchFromMount as fetch } from "../../src/assets/_fetch-mount";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("_fetch-mount", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `kyushu-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 405 for non-GET/HEAD methods", async () => {
    const res = await fetch({ method: "POST", url: "http://localhost/" });
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid URL", async () => {
    const res = await fetch({ method: "GET", url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when file not found", async () => {
    const res = await fetch({ method: "GET", url: `http://localhost${dir}/missing.html` });
    expect(res.status).toBe(404);
  });

  it("returns 200 with file bytes", async () => {
    const filepath = join(dir, "index.html");
    await writeFile(filepath, "<html></html>");
    const res = await fetch({ method: "GET", url: `http://localhost${filepath}` });
    expect(res.status).toBe(200);
    expect(res.headers?.["content-type"]).toBe("text/html");
  });

  it("returns last-modified header", async () => {
    const filepath = join(dir, "index.html");
    await writeFile(filepath, "<html></html>");
    const res = await fetch({ method: "GET", url: `http://localhost${filepath}` });
    expect(res.headers?.["last-modified"]).toBeDefined();
  });

  it("returns HEAD response without body", async () => {
    const filepath = join(dir, "index.html");
    await writeFile(filepath, "<html></html>");
    const res = await fetch({ method: "HEAD", url: `http://localhost${filepath}` });
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
  });

  it("returns 304 when etag matches", async () => {
    const filepath = join(dir, "index.html");
    await writeFile(filepath, "<html></html>");
    const res1 = await fetch({ method: "GET", url: `http://localhost${filepath}` });
    const etag = res1.headers?.["etag"];
    const res2 = await fetch({
      method: "GET",
      url: `http://localhost${filepath}`,
      headers: { "if-none-match": etag! },
    });
    expect(res2.status).toBe(304);
  });
});
