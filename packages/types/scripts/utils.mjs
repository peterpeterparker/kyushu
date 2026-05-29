import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const DIST = join(process.cwd(), "dist");

export const createDistFolder = () => {
  if (!existsSync(DIST)) {
    mkdirSync(DIST);
  }
};
