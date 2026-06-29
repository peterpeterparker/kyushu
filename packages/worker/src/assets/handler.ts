import type { EnvAssets } from "kyushu-types";
import { fetchFromFs } from "./_fetch-fs";
import { fetchFromMemory } from "./_fetch-memory";

export const fetch: EnvAssets["fetch"] = async (request, options) => {
  if (options?.src === "fs") {
    return await fetchFromFs(request);
  }

  return await fetchFromMemory(request);
};
