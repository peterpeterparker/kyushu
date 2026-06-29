import type { EnvAssets } from "kyushu-types";
import { fetchFromMount } from "./_fetch-mount";
import { fetchFromMemory } from "./_fetch-memory";

export const fetch: EnvAssets["fetch"] = async (request, options) => {
  if (options?.src === "mount") {
    return await fetchFromMount(request);
  }

  return await fetchFromMemory(request);
};
