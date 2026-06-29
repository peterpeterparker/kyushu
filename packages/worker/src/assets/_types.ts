export type Etag = string;

/**
 * A static asset e.g. bundled into the worker at build time or read at runtime from the file system.
 */
export type Asset = WorkerAsset;

export type CompressionEncoding = "br" | "gz";
export type CompressedAsset = { asset: Asset; encoding: CompressionEncoding };

export type GetAssetFn = (path: string) => Promise<Asset | undefined>;
