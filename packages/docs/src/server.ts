import type { ExportedHandler, WorkerMethod, WorkerRequest, WorkerResponse } from "kyushu-types";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import mime from "mime-types";
import { Buffer } from "node:buffer";
import { Stats } from "node:fs";
import { createHash } from "node:crypto";

type Result<T> = { status: "success"; result: T } | { status: "error"; err: unknown };

const safeExec = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    const result = await fn();
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

const fileExists = async ({ filepath }: { filepath: string }): Promise<boolean> => {
  try {
    const stats = await stat(filepath);
    return stats.isFile();
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

const resolveFilepath = async ({ pathname }: Pick<URL, "pathname">): Promise<string | null> => {
  const filepath = join(process.cwd(), "dist", pathname);

  if (await fileExists({ filepath })) {
    return filepath;
  }

  const aliases = aliasesOf({ pathname: pathname });

  for (const alias of aliases ?? []) {
    const filepathAlias = join(process.cwd(), "dist", alias);

    if (await fileExists({ filepath: filepathAlias })) {
      return filepathAlias;
    }
  }

  return null;
};

const resolveCompressedFilepath = async ({
  filepath,
  headers,
}: { filepath: string } & Pick<WorkerRequest, "headers">): Promise<string | null> => {
  if (headers?.["accept-encoding"]?.includes("br") !== true) {
    return null;
  }

  const compressedFilepath = `${filepath}.br`;

  if (await fileExists({ filepath: compressedFilepath })) {
    return compressedFilepath;
  }

  return null;
};

type Etag = string;

const buildResponse = async ({
  filepath,
  compressedFilepath,
  pathname,
  method,
  ifNoneMatch,
}: {
  filepath: string;
  compressedFilepath: string | null;
  method: Extract<WorkerMethod, "GET" | "HEAD">;
  ifNoneMatch: Etag | undefined;
} & Pick<URL, "pathname">): Promise<WorkerResponse> => {
  const effectivePath = compressedFilepath ?? filepath;

  type BodyResponse = {
    body: Buffer<ArrayBuffer>;
  } & Pick<Stats, "size" | "mtime">;

  const buildBody = async (): Promise<BodyResponse> => {
    const [file, stats] = await Promise.all([
      readFile(effectivePath),
      stat(effectivePath),
    ] as const);

    return {
      body: file,
      ...stats,
    };
  };

  const { body, size: byteLength, mtime: lastModified } = await buildBody();

  const etag = `"${createHash("md5").update(body).digest("hex")}"`;

  const cache = CACHE_HEADERS[extname(filepath)];

  const headers: WorkerResponse["headers"] = {
    ...SECURITY_HEADERS,
    "last-modified": lastModified.toUTCString(),
    etag,
    vary: "Accept-Encoding",
    ...(cache !== undefined && { "cache-control": cache.join(", ") }),
  };

  if (ifNoneMatch === etag) {
    return { status: 304, headers };
  }

  const mimeType = mime.lookup(filepath);

  return {
    status: 200,
    headers: {
      ...headers,
      "content-type":
        typeof mimeType === "string"
          ? mimeType
          : (CUSTOM_MIME_TYPES[pathname] ?? "application/octet-stream"),
      "content-length": `${byteLength}`,
      ...(compressedFilepath !== null && {
        "content-encoding": "br",
      }),
    },
    ...(method === "GET" && { body }),
  };
};

export default {
  async fetch({ url: requestUrl, headers, method }) {
    if (method !== "GET" && method !== "HEAD") {
      return { status: 405, body: "Method Not Allowed" };
    }

    const url = URL.parse(requestUrl);

    if (url === null) {
      return { status: 400, body: "Bad Request" };
    }

    const { pathname } = url;

    const filepathResult = await safeExec(async () => await resolveFilepath({ pathname }));

    if (filepathResult.status === "error") {
      console.error(filepathResult.err);
      return { status: 500, body: "Internal Server Error" };
    }

    const { result: filepath } = filepathResult;

    if (filepath === null) {
      return { status: 404, body: "Not Found" };
    }

    const compressedFilepathResult = await safeExec(
      async () => await resolveCompressedFilepath({ filepath, headers }),
    );

    if (compressedFilepathResult.status === "error") {
      console.error(compressedFilepathResult.err);
      return { status: 500, body: "Internal Server Error" };
    }

    const { result: compressedFilepath } = compressedFilepathResult;

    const responseResult = await safeExec(
      async () =>
        await buildResponse({
          filepath,
          compressedFilepath,
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
  },
} satisfies ExportedHandler;
