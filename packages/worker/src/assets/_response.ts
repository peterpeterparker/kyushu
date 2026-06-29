import type { WorkerResponse, WorkerMethod } from "kyushu-types";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { Asset, CompressedAsset, Etag } from "./_types";

// List of recommended security headers as per https://owasp.org/www-satellite-secure-headers/
// These headers enable browser security features (like limit access to platform apis and set
// iFrame policies, etc.).
const SECURITY_HEADERS: WorkerResponse["headers"] = {
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000 ; includeSubDomains",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const CACHE_HEADERS: Record<string, [string, ...string[]]> = {
  ".svg": ["public", "max-age=2592000"],
  ".css": ["public", "max-age=2592000", "immutable"],
  ".js": ["public", "max-age=2592000", "immutable"],
  ".woff2": ["public", "max-age=31536000", "immutable"],
};

/**
 * Builds an HTTP response for a static asset.
 *
 * Handles ETag generation, cache headers, security headers, content-type resolution,
 * last-modified, and optional brotli/gzip content encoding.
 *
 * @param asset - The primary asset with bytes, mime type, and last modified timestamp.
 * @param compressedAsset - An optional pre-compressed variant of the asset to serve instead.
 * @param pathname - The URL pathname, used to determine cache headers by file extension.
 * @param method - The HTTP method. Only `GET` responses include a body; `HEAD` responses do not.
 * @param ifNoneMatch - The value of the `If-None-Match` request header for ETag validation.
 * @returns A `WorkerResponse` with appropriate headers and body.
 */
export const buildAssetResponse = ({
  asset,
  compressedAsset,
  pathname,
  method,
  ifNoneMatch,
}: {
  asset: Asset;
  compressedAsset: CompressedAsset | undefined;
  method: Extract<WorkerMethod, "GET" | "HEAD">;
  ifNoneMatch: Etag | undefined;
} & Pick<URL, "pathname">): WorkerResponse => {
  const { bytes } = compressedAsset?.asset ?? asset;
  const { mimeType, lastModified } = asset;

  const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;

  const cache = CACHE_HEADERS[extname(pathname)];

  const headers: WorkerResponse["headers"] = {
    ...SECURITY_HEADERS,
    etag,
    vary: "Accept-Encoding",
    ...(lastModified !== undefined && {
      "last-modified": new Date(lastModified * 1000).toUTCString(),
    }),
    ...(cache !== undefined && { "cache-control": cache.join(", ") }),
  };

  if (ifNoneMatch === etag) {
    return { status: 304, headers };
  }

  return {
    status: 200,
    headers: {
      ...headers,
      "content-type":
        mimeType !== undefined && mimeType !== "" ? mimeType : "application/octet-stream",
      "content-length": `${bytes.length}`,
      ...(compressedAsset !== undefined && {
        "content-encoding": compressedAsset.encoding,
      }),
    },
    ...(method === "GET" && { body: bytes }),
  };
};
