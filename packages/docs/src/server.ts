import type { ExportedHandler } from "kyushu-types";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromBuffer } from "file-type";

const CUSTOM_MIME_TYPES: Record<string, string> = {
  "/install": "text/x-shellscript",
};

export default {
  async fetch({ url: requestUrl }) {
    const url = URL.parse(requestUrl);

    if (url === null) {
      return { status: 400, body: "Bad Request" };
    }

    const { pathname } = url;

    const sanitizedPathname = pathname === "/" ? "/index.html" : pathname;
    const filepath = join(process.cwd(), "public", sanitizedPathname);

    try {
      await access(filepath);
    } catch {
      return { status: 404, body: "Not Found" };
    }

    try {
      const file = await readFile(filepath);
      const fileType = await fileTypeFromBuffer(file);

      return {
        status: 200,
        headers: {
          "content-type":
            fileType?.mime ?? CUSTOM_MIME_TYPES[sanitizedPathname] ?? "application/octet-stream",
        },
        body: file,
      };
    } catch (err: unknown) {
      console.error(err);
      return { status: 500, body: "Internal Server Error" };
    }
  },
} satisfies ExportedHandler;
