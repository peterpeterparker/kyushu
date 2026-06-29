declare global {
  /**
   * A static asset bundled into the worker at build time.
   */
  interface WorkerAsset {
    bytes: Uint8Array<ArrayBuffer>;
    mimeType?: string;
    lastModified?: number;
  }

  /**
   * Returns the asset at the given path, or `undefined` if not found.
   *
   * @throws If no assets are configured.
   */
  function __kyushu_get_asset__(path: string): WorkerAsset | undefined;

  /**
   * Returns `true` if static assets are configured for this worker.
   */
  function __kyushu_has_assets__(): boolean;
}

export {};
