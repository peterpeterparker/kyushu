import type { EnvAssets } from "kyushu-types";
import { Asset, GetAssetFn } from "./_types";
import { readFile, stat } from "node:fs/promises";
import { resolveAndFetch } from "./_fetch";
import mime from "mime-types";

export const fetchFromMount: EnvAssets["fetch"] = async (request) => {
  return await resolveAndFetch({
    request,
    getAssetFn: getAsset,
  });
};

const getAsset: GetAssetFn = async (path) => {
  if (await fileExists({ filepath: path })) {
    return await buildAsset({ filepath: path });
  }

  return undefined;
};

const buildAsset = async ({ filepath }: { filepath: string }): Promise<Asset> => {
  const [file, stats] = await Promise.all([readFile(filepath), stat(filepath)] as const);

  const mimeType = mime.lookup(filepath);

  const { mtime: lastModified } = stats;

  return {
    bytes: file,
    lastModified: Math.floor(lastModified.getTime() / 1000),
    ...(mimeType !== undefined && typeof mimeType === "string" && { mimeType }),
  };
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
