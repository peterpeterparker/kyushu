---
title: Configuration
description: Reference for kyushu.build.toml and kyushu.run.toml.
---

Kyushu uses two separate config files: one for building workers and one for running them.

Commonly you use the build config on your local machine and in CI, while the run config lives where you serve your worker.

## kyushu.build.toml

Controls how `kyu build` bundles and pre-initializes your worker.

| Field    | Type   | Description                                       |
| -------- | ------ | ------------------------------------------------- |
| `entry`  | string | Path to your TypeScript or JavaScript entry point |
| `outdir` | string | Output directory for the built worker             |

```toml
entry = "src/index.ts"
outdir = "dist"
```

## kyushu.run.toml

Controls how `kyu run` loads and serves your worker.

| Field               | Type   | Description                                           |
| ------------------- | ------ | ----------------------------------------------------- |
| `worker.wasm`       | string | Path to the built worker `.wasm` file                 |
| `worker.port`       | number | Port to listen on (default: `5987`)                   |
| `mounts`            | array  | Filesystem mounts to expose to the worker             |
| `mounts[].host`     | string | Path on the host filesystem                           |
| `mounts[].guest`    | string | Path inside the worker sandbox                        |
| `mounts[].writable` | bool   | Whether the mount is writable (defaults to read-only) |
| `env`               | array  | Environment variables to expose to the worker         |
| `env[].key`         | string | Environment variable name                             |
| `env[].value`       | string | Environment variable value                            |

```toml
[worker]
wasm = "dist/__kyushu_worker.wasm"
port = 5987

[[mounts]]
host = "./public"
guest = "/public"

[[mounts]]
host = "./data"
guest = "/data"
writable = true

[[env]]
key = "API_KEY"
value = "secret"
```
