import type { Env } from "kyushu-types";
import { fetch } from "./assets/handler";

export const buildEnv = (): Env => ({
  ASSETS: {
    fetch,
  },
});
