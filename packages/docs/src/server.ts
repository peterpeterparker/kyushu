import type { ExportedHandler } from "kyushu-types";

const CUSTOM_MIME_TYPES: Record<string, string> = {
  "/install": "text/x-shellscript",
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    const { pathname } = URL.parse(request.url) ?? { pathname: null };
    const customMimeType = pathname != null ? CUSTOM_MIME_TYPES[pathname] : undefined;

    return {
      ...response,
      headers: {
        ...response.headers,
        "content-type": customMimeType ?? response.headers["content-type"],
      },
    };
  },
} satisfies ExportedHandler;
