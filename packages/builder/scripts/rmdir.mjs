#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const rmDir = () => {
  const dir = join(process.cwd(), "dist");

  if (!existsSync(dir)) {
    return;
  }

  rmSync(dir, { recursive: true });
};

rmDir();
