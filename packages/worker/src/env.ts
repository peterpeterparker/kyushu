import type { Env } from "kyushu-types";
import { fetch } from "./assets";
import type { WorkerResponse } from "kyushu-types";

export const notImplemented = async (): Promise<WorkerResponse> => {
  return { status: 501, body: "Not Implemented" };
};

export const buildEnv = (): Env => ({
  ASSETS: {
    fetch: __kyushu_has_assets__() ? fetch : notImplemented,
  },
});
