import type { EnvAssets, WorkerRequest, WorkerResponse, WorkerMethod } from "kyushu-types";
import { extname } from "node:path";
import { createHash } from "node:crypto";

type Result<T> = { status: "success"; result: T } | { status: "error"; err: unknown };

const safeExec = <T>(fn: () => T): Result<T> => {
  try {
    const result = fn();
    return { status: "success", result };
  } catch (err: unknown) {
    return { status: "error", err };
  }
};

const CUSTOM_MIME_TYPES: Record<string, string> = {
  "/install": "text/x-shellscript",
};

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

const aliasesOf = ({ pathname }: Pick<URL, "pathname">): [string, ...string[]] | undefined => {
  if (pathname.endsWith("/")) {
    return [`${pathname}index.html`];
  } else if (!pathname.endsWith(".html")) {
    return [`${pathname}.html`, `${pathname}/index.html`];
  } else {
    return undefined;
  }
};

const resolveAsset = ({ pathname }: Pick<URL, "pathname">): Asset | undefined => {
  const asset = __kyushu_get_asset__(pathname);

  if (asset !== undefined) {
    return asset;
  }

  const aliases = aliasesOf({ pathname });

  for (const alias of aliases ?? []) {
    const aliasAsset = __kyushu_get_asset__(alias);

    if (aliasAsset !== undefined) {
      return aliasAsset;
    }
  }

  return undefined;
};

const resolveCompressedAsset = ({
  pathname,
  headers,
}: Pick<URL, "pathname"> & { headers: WorkerRequest["headers"] }): Asset | undefined => {
  if (headers?.["accept-encoding"]?.includes("br") !== true) {
    return undefined;
  }

  return __kyushu_get_asset__(`${pathname}.br`);
};

type Etag = string;

const buildResponse = ({
  asset,
  compressedAsset,
  pathname,
  method,
  ifNoneMatch,
}: {
  asset: Asset;
  compressedAsset: Asset | undefined;
  method: Extract<WorkerMethod, "GET" | "HEAD">;
  ifNoneMatch: Etag | undefined;
} & Pick<URL, "pathname">): WorkerResponse => {
  const { bytes } = compressedAsset ?? asset;
  const { mimeType } = asset;

  const etag = `"${createHash("md5").update(bytes).digest("hex")}"`;

  const cache = CACHE_HEADERS[extname(pathname)];

  const headers: WorkerResponse["headers"] = {
    ...SECURITY_HEADERS,
    // TODO
    //  "last-modified": lastModified.toUTCString(),
    etag,
    vary: "Accept-Encoding",
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
        typeof mimeType === "string"
          ? mimeType
          : // TODO: should we deal with custom mime types?
            (CUSTOM_MIME_TYPES[pathname] ?? "application/octet-stream"),
      "content-length": `${bytes.length}`,
      ...(compressedAsset !== undefined && {
        "content-encoding": "br",
      }),
    },
    ...(method === "GET" && { body: bytes }),
  };
};

export const fetch: EnvAssets["fetch"] = async ({ url: requestUrl, headers, method }) => {
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, body: "Method Not Allowed" };
  }

  const url = URL.parse(requestUrl);

  if (url === null) {
    return { status: 400, body: "Bad Request" };
  }

  const { pathname } = url;

  const assetResult = safeExec(() => resolveAsset({ pathname }));

  if (assetResult.status === "error") {
    console.error(assetResult.err);
    return { status: 500, body: "Internal Server Error" };
  }

  const { result: asset } = assetResult;

  if (asset === undefined) {
    return { status: 404, body: "Not Found" };
  }

  const compressedFilepathResult = safeExec(() => resolveCompressedAsset({ pathname, headers }));

  if (compressedFilepathResult.status === "error") {
    console.error(compressedFilepathResult.err);
    return { status: 500, body: "Internal Server Error" };
  }

  const { result: compressedAsset } = compressedFilepathResult;

  const responseResult = safeExec(() =>
    buildResponse({
      asset,
      compressedAsset,
      pathname,
      method,
      ifNoneMatch: headers?.["if-none-match"],
    }),
  );

  if (responseResult.status === "error") {
    console.error(responseResult.err);
    return { status: 500, body: "Internal Server Error" };
  }

  const { result: response } = responseResult;
  return response;
};
