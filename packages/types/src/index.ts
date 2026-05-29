import * as z from "zod/mini";

export const Uint8ArraySchema = z.instanceof(Uint8Array);
export const ArrayBufferSchema = z.instanceof(ArrayBuffer);

/**
 * @see WorkerMethod
 */
export const WorkerMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * @see WorkerRequest
 */
export const WorkerRequestSchema = z.strictObject({
  method: WorkerMethodSchema,
  url: z.url(),
  headers: z.optional(z.record(z.string(), z.string())),
  body: z.optional(z.union([z.string(), z.union([ArrayBufferSchema, Uint8ArraySchema])])),
});

/**
 * @see WorkerResponse
 */
export const WorkerResponseSchema = z.strictObject({
  status: z.optional(z.number()),
  body: z.optional(z.union([z.string(), z.union([ArrayBufferSchema, Uint8ArraySchema])])),
  headers: z.optional(z.record(z.string(), z.string())),
});

/**
 * @see ExportedHandler
 */
export const ExportedHandlerSchema = z.strictObject({
  fetch: z.function({
    input: z.tuple([WorkerRequestSchema]),
    output: z.promise(WorkerResponseSchema),
  }),
});

/**
 * HTTP methods supported by Kyushu workers.
 */
export type WorkerMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/**
 * An incoming HTTP request passed to the worker's fetch handler.
 */
export interface WorkerRequest {
  /** The HTTP method. */
  method: WorkerMethod;
  /** The full request URL. */
  url: string;
  /** The request headers as a key-value map, if present. */
  headers?: Record<string, string>;
  /** The request body, if present. */
  body?: string | ArrayBuffer | Uint8Array;
}

/**
 * The HTTP response returned by the worker's fetch handler.
 */
export interface WorkerResponse {
  /** The HTTP status code. Defaults to 200. */
  status?: number;
  /** The response body. */
  body?: string | ArrayBuffer | Uint8Array;
  /** The response headers as a key-value map. */
  headers?: Record<string, string>;
}

/**
 * The default export shape expected by Kyushu workers.
 *
 * @example
 * ```ts
 * import type { ExportedHandler } from "kyushu-types";
 *
 * export default {
 *   fetch(request) {
 *     return { status: 200, body: "Hello, world!" };
 *   },
 * } satisfies ExportedHandler;
 * ```
 */
export interface ExportedHandler {
  fetch(request: WorkerRequest): Promise<WorkerResponse>;
}

export default ExportedHandler;
