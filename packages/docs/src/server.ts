import type { ExportedHandler, WorkerResponse } from "kyushu-types";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import mime from "mime-types";

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

const buildResponse = async ({
  filepath,
  pathname,
}: { filepath: string } & Pick<URL, "pathname">): Promise<WorkerResponse> => {
  const file = await readFile(filepath);
  const mimeType = mime.lookup(filepath);

  return {
    status: 200,
    headers: {
      "content-type":
        typeof mimeType === "string"
          ? mimeType
          : (CUSTOM_MIME_TYPES[pathname] ?? "application/octet-stream"),
      "content-length": `${file.byteLength}`,
    },
    body: file,
  };
};

export default {
  async fetch({ url: requestUrl }) {
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

    const responseResult = await safeExec(async () => await buildResponse({ filepath, pathname }));

    if (responseResult.status === "error") {
      console.error(responseResult.err);
      return { status: 500, body: "Internal Server Error" };
    }

    const { result: response } = responseResult;
    return response;
  },
} satisfies ExportedHandler;
