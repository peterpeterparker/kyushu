import type { WorkerRequest } from "kyushu-types";
import { buildAssetResponse } from "./_response";
import { Asset, CompressedAsset, CompressionEncoding, GetAssetFn } from "./_types";

type Result<T> = { status: "success"; result: T } | { status: "error"; err: unknown };

const safeExec = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    const result = await fn();
    return { status: "success", result };
  } catch (err: unknown) {
    return { status: "error", err };
  }
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

const resolveAsset = async ({
  pathname,
  getAssetFn,
}: Pick<URL, "pathname"> & { getAssetFn: GetAssetFn }): Promise<
  { asset: Asset; resolvedPathname: string } | undefined
> => {
  const asset = await getAssetFn(pathname);

  if (asset !== undefined) {
    return { asset, resolvedPathname: pathname };
  }

  const aliases = aliasesOf({ pathname });

  for (const alias of aliases ?? []) {
    const aliasAsset = await getAssetFn(alias);

    if (aliasAsset !== undefined) {
      return { asset: aliasAsset, resolvedPathname: alias };
    }
  }

  return undefined;
};

const resolveCompressedAsset = async ({
  pathname,
  headers,
  getAssetFn,
}: Pick<URL, "pathname"> & { headers: WorkerRequest["headers"]; getAssetFn: GetAssetFn }): Promise<
  CompressedAsset | undefined
> => {
  const acceptEncoding = headers?.["accept-encoding"];

  const resolveAsset = async (
    encoding: CompressionEncoding,
  ): Promise<CompressedAsset | undefined> => {
    const asset = await getAssetFn(`${pathname}.${encoding}`);

    return asset !== undefined ? { asset, encoding } : undefined;
  };

  if (acceptEncoding?.includes("br") === true) {
    return await resolveAsset("br");
  }

  if (acceptEncoding?.includes("gzip") === true) {
    return await resolveAsset("gz");
  }

  return undefined;
};

export const resolveAndFetch = async ({
  request: { url: requestUrl, headers, method },
  getAssetFn,
}: {
  request: WorkerRequest;
  getAssetFn: GetAssetFn;
}) => {
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, body: "Method Not Allowed" };
  }

  const url = URL.parse(requestUrl);

  if (url === null) {
    return { status: 400, body: "Bad Request" };
  }

  const { pathname } = url;

  const assetResult = await safeExec(() => resolveAsset({ pathname, getAssetFn }));

  if (assetResult.status === "error") {
    console.error(assetResult.err);
    return { status: 500, body: "Internal Server Error" };
  }

  const { result } = assetResult;

  if (result === undefined) {
    return { status: 404, body: "Not Found" };
  }

  const { asset, resolvedPathname } = result;

  const compressedFilepathResult = await safeExec(() =>
    resolveCompressedAsset({ pathname: resolvedPathname, headers, getAssetFn }),
  );

  if (compressedFilepathResult.status === "error") {
    console.error(compressedFilepathResult.err);
    return { status: 500, body: "Internal Server Error" };
  }

  const { result: compressedAsset } = compressedFilepathResult;

  const responseResult = await safeExec(async () =>
    buildAssetResponse({
      asset,
      compressedAsset,
      pathname: resolvedPathname,
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
