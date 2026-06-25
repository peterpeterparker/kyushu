import type { Env } from "kyushu-types";
import { fetch } from "./assets";

export const buildEnv = (): Env => ({
  ...(__kyushu_has_assets__() && {
    ASSETS: {
      fetch,
    },
  }),
});
