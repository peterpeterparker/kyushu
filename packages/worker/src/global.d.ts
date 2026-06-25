declare global {
  /**
   * A static asset bundled into the worker at build time.
   */
  interface Asset {
    bytes: Uint8Array;
    mimeType?: string;
  }

  /**
   * Returns the asset at the given path, or `null` if not found.
   *
   * @throws If no assets are configured.
   */
  function __kyushu_get_asset__(path: string): Asset | null;

  /**
   * Returns `true` if static assets are configured for this worker.
   */
  function __kyushu_has_assets__(): boolean;
}

export {};
