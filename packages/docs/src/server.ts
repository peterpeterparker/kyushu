import type { ExportedHandler } from "kyushu-types";

const CUSTOM_MIME_TYPES: Record<string, string> = {
  "/install": "text/x-shellscript",
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS?.fetch(request);

    if (response === undefined) {
      return { status: 500, body: "Internal Server Error" };
    }

    const { pathname } = URL.parse(request.url) ?? { pathname: null };
    const customMimeType = pathname != null ? CUSTOM_MIME_TYPES[pathname] : undefined;

    const contentType = customMimeType ?? response.headers?.["content-type"];

    return {
      ...response,
      headers: {
        ...response.headers,
        ...(contentType !== undefined && { "content-type": contentType }),
      },
    };
  },
} satisfies ExportedHandler;
