#!/usr/bin/env node

import esbuild from "esbuild";
import { join } from "node:path";
import { externalPeerDependencies } from "./pkg.mjs";
import { createDistFolder, DIST } from "./utils.mjs";

const buildNode = () => {
  // esm output bundle for Node
  esbuild
    .build({
      entryPoints: ["src/index.ts"],
      outfile: join(DIST, "index.mjs"),
      bundle: true,
      sourcemap: true,
      minify: true,
      splitting: false,
      format: "esm",
      platform: "node",
      target: ["node20", "esnext"],
      external: externalPeerDependencies,
    })
    .catch(() => process.exit(1));
};

export const build = () => {
  createDistFolder();

  buildNode();
};

build();
