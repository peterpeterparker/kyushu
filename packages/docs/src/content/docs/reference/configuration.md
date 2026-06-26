---
title: Configuration
description: Reference for kyu build, kyu run, and kyu dev configuration.
---

Kyushu works out of the box. Each command uses defaults but supports its own optional config file to override them.

The build config typically lives on your local machine and in CI, while the run config lives where you serve your worker.

:::note
You can split your configuration across separate files for development and your server, or keep everything in a single e.g. `kyushu.toml`. There are no strict rules, up to you.
:::

## Build

Controls how `kyu build` bundles and pre-initializes your worker.

| Field         | Type   | Default                | Description                                       |
| ------------- | ------ | ---------------------- | ------------------------------------------------- |
| `input.src`   | string | `src/index.ts`         | Path to your TypeScript or JavaScript entry point |
| `output.dir`  | string | `worker`               | Output directory for the built worker             |
| `output.file` | string | `__kyushu_worker.wasm` | Output filename for the built worker              |

```toml
[input]
src = "src/server.ts"

[output]
dir = "dist"
```

## Assets

Controls static asset bundling during `kyu build`. See the [Static Assets guide](/guides/static-assets) for setup instructions.

| Field                | Type   | Default | Description                                               |
| -------------------- | ------ | ------- | --------------------------------------------------------- |
| `assets.dir`         | string | —       | Directory of static assets to bundle into the worker      |
| `assets.precompress` | array  | —       | Compression formats to pre-generate: `"brotli"`, `"gzip"` |

```toml
[assets]
dir = "dist"
precompress = ["brotli", "gzip"]
```

## Run

Controls how `kyu run` loads and serves your worker.

| Field                      | Type   | Default                       | Description                                   |
| -------------------------- | ------ | ----------------------------- | --------------------------------------------- |
| `run.wasm`                 | string | `worker/__kyushu_worker.wasm` | Path to the built worker `.wasm` file         |
| `run.port`                 | number | `5987`                        | Port to listen on                             |
| `worker.mounts`            | array  | —                             | Filesystem mounts to expose to the worker     |
| `worker.mounts[].host`     | string | —                             | Path on the host filesystem                   |
| `worker.mounts[].guest`    | string | —                             | Path inside the worker sandbox                |
| `worker.mounts[].writable` | bool   | `false`                       | Whether the mount is writable                 |
| `worker.env`               | array  | —                             | Environment variables to expose to the worker |
| `worker.env[].key`         | string | —                             | Environment variable name                     |
| `worker.env[].value`       | string | —                             | Environment variable value                    |

```toml
[run]
wasm = "build/__custom_kyushu_worker.wasm"
port = 8080

[[worker.mounts]]
host = "./public"
guest = "/public"

[[worker.mounts]]
host = "./data"
guest = "/data"
writable = true

[[worker.env]]
key = "API_KEY"
value = "secret"
```

## Dev

Controls how `kyu dev` serves your worker during development with live-reload.

```toml
[dev]
port = 5987  # default
```

| Field       | Type   | Default | Description                                     |
| ----------- | ------ | ------- | ----------------------------------------------- |
| `dev.port`  | number | `5987`  | Port to listen on                               |
| `dev.watch` | bool   | `true`  | Watch for file changes and reload automatically |

A custom `[input]` or `[worker]` configuration can also be applied; the details are omitted for brevity but follow the same options documented above.
