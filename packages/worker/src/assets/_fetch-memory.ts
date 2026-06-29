import { resolveAndFetch } from "./_fetch";
import type { EnvAssets } from "kyushu-types";
import { GetAssetFn } from "./_types";

export const fetchFromMemory: EnvAssets["fetch"] = async (request) => {
  return await resolveAndFetch({
    request,
    getAssetFn: getAsset,
  });
};

const getAsset: GetAssetFn = async (path) => {
  return __kyushu_get_asset__(path);
};
