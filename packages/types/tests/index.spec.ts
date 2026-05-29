import {
  ExportedHandlerSchema,
  WorkerMethodSchema,
  WorkerRequestSchema,
  WorkerResponseSchema,
} from "../src";

describe("WorkerMethodSchema", () => {
  it("accepts valid methods", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(() => WorkerMethodSchema.parse(method)).not.toThrow();
    }
  });

  it("rejects invalid method", () => {
    expect(() => WorkerMethodSchema.parse("CONNECT")).toThrow();
  });
});

describe("WorkerRequestSchema", () => {
  it("accepts minimal valid request", () => {
    expect(() =>
      WorkerRequestSchema.parse({ method: "GET", url: "http://localhost/" }),
    ).not.toThrow();
  });

  it("accepts full valid request with string body", () => {
    expect(() =>
      WorkerRequestSchema.parse({
        method: "POST",
        url: "http://localhost/api",
        headers: { "content-type": "application/json" },
        body: '{"hello":"world"}',
      }),
    ).not.toThrow();
  });

  it("accepts full valid request with ArrayBuffer body", () => {
    expect(() =>
      WorkerRequestSchema.parse({
        method: "POST",
        url: "http://localhost/api",
        body: new ArrayBuffer(4),
      }),
    ).not.toThrow();
  });

  it("accepts full valid request with Uint8Array body", () => {
    expect(() =>
      WorkerRequestSchema.parse({
        method: "POST",
        url: "http://localhost/api",
        body: new Uint8Array([1, 2, 3]),
      }),
    ).not.toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      WorkerRequestSchema.parse({ method: "GET", url: "http://localhost/", extra: "field" }),
    ).toThrow();
  });

  it("rejects invalid url", () => {
    expect(() => WorkerRequestSchema.parse({ method: "GET", url: "not-a-url" })).toThrow();
  });

  it("rejects invalid method", () => {
    expect(() =>
      WorkerRequestSchema.parse({ method: "CONNECT", url: "http://localhost/" }),
    ).toThrow();
  });

  it("rejects missing method", () => {
    expect(() => WorkerRequestSchema.parse({ url: "http://localhost/" })).toThrow();
  });
});

describe("WorkerResponseSchema", () => {
  it("accepts minimal valid response", () => {
    expect(() => WorkerResponseSchema.parse({})).not.toThrow();
  });

  it("accepts response with explicit status", () => {
    expect(() => WorkerResponseSchema.parse({ status: 200 })).not.toThrow();
  });

  it("accepts full valid response with string body", () => {
    expect(() =>
      WorkerResponseSchema.parse({
        status: 200,
        body: "Hello",
        headers: { "content-type": "text/plain" },
      }),
    ).not.toThrow();
  });

  it("accepts full valid response with ArrayBuffer body", () => {
    expect(() =>
      WorkerResponseSchema.parse({
        status: 200,
        body: new ArrayBuffer(4),
      }),
    ).not.toThrow();
  });

  it("accepts full valid response with Uint8Array body", () => {
    expect(() =>
      WorkerResponseSchema.parse({
        status: 200,
        body: new Uint8Array([1, 2, 3]),
      }),
    ).not.toThrow();
  });

  it("rejects extra keys", () => {
    expect(() => WorkerResponseSchema.parse({ status: 200, extra: "field" })).toThrow();
  });

  it("accepts missing status", () => {
    expect(() => WorkerResponseSchema.parse({ body: "hello" })).not.toThrow();
  });
});

describe("ExportedHandlerSchema", () => {
  it("accepts valid handler", () => {
    expect(() =>
      ExportedHandlerSchema.parse({ fetch: async (_req: unknown) => ({ status: 200 }) }),
    ).not.toThrow();
  });

  it("rejects missing fetch", () => {
    expect(() => ExportedHandlerSchema.parse({})).toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ExportedHandlerSchema.parse({
        fetch: async (_req: unknown) => ({ status: 200 }),
        extra: "field",
      }),
    ).toThrow();
  });

  it("rejects non-function fetch", () => {
    expect(() => ExportedHandlerSchema.parse({ fetch: "not-a-function" })).toThrow();
  });
});
