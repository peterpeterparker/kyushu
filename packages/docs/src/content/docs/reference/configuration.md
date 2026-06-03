---
title: Configuration
description: Reference for kyu build and kyu run configuration.
---

Kyushu works out of the box. Each command uses defaults but supports its own optional config file to override them.

The build config typically lives on your local machine and in CI, while the run config lives where you serve your worker.

## Build

Controls how `kyu build` bundles and pre-initializes your worker.

| Field     | Type   | Default                | Description                                       |
| --------- | ------ | ---------------------- | ------------------------------------------------- |
| `entry`   | string | `src/index.ts`         | Path to your TypeScript or JavaScript entry point |
| `outdir`  | string | `worker`               | Output directory for the built worker             |
| `outfile` | string | `__kyushu_worker.wasm` | Output filename for the built worker              |

```toml title="kyushu.build.toml"
entry = "src/server.ts"
outdir = "dist"
```

## Run

Controls how `kyu run` loads and serves your worker.

| Field               | Type   | Default                       | Description                                           |
| ------------------- | ------ | ----------------------------- | ----------------------------------------------------- |
| `worker.wasm`       | string | `worker/__kyushu_worker.wasm` | Path to the built worker `.wasm` file                 |
| `worker.port`       | number | `5987`                        | Port to listen on                                     |
| `mounts`            | array  | —                             | Filesystem mounts to expose to the worker             |
| `mounts[].host`     | string | —                             | Path on the host filesystem                           |
| `mounts[].guest`    | string | —                             | Path inside the worker sandbox                        |
| `mounts[].writable` | bool   | `false`                       | Whether the mount is writable (defaults to read-only) |
| `env`               | array  | —                             | Environment variables to expose to the worker         |
| `env[].key`         | string | —                             | Environment variable name                             |
| `env[].value`       | string | —                             | Environment variable value                            |

```toml title="kyushu.run.toml"
[worker]
wasm = "build/__custom_kyushu_worker.wasm"
port = 8080

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
