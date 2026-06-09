# Kyushu

Ever wanted to run a Cloudflare Workers-style JavaScript handler in a sandbox, on a VPS or anywhere, without Node.js, Bun, or even Docker? Kyushu lets you do exactly that.

Write a simple `fetch` handler, build it into a self-contained WebAssembly binary, and run it anywhere with a single CLI binary - `kyu`.

> [!IMPORTANT]
> Kyushu is an early-stage experiment. Expect breaking changes, missing features, and rough edges. Not recommended for production use.

## Motivation

Kyushu grew out of my experience building [Juno](https://github.com/junobuild/juno), a platform where apps run in some sort of containers. I liked the concept, and when I tried Cloudflare Workers it clicked: a single function, sandboxed, handling HTTP, kind of what I implemented in the past but, for VPS or anywhere.

When you think about it, in an era where AI agents need safe environments to execute untrusted code, having a lightweight, self-hostable Wasm sandbox could be relevant, whether for running user-defined logic, isolating third-party code, or deploying edge-like handlers on your own infrastructure.

Plus, find it fun to try to avoid using Node or Bun. Long story short, felt like it was worth experimenting.

## How it works

Kyushu has two moving parts:

**The worker** is a `wasm32-wasip2` component that embeds a QuickJS JavaScript runtime. When you run `kyu build`, your TypeScript or JavaScript entry point is bundled (via [Rolldown](https://rolldown.rs)) and pre-initialized into the worker using [Wizer](https://github.com/bytecodealliance/wizer). The resulting `.wasm` file contains your code, frozen in memory, ready to handle requests.

**The runner** (`kyu run`) is a Rust binary powered by [Wasmtime](https://wasmtime.io). It loads your built worker, spins up an HTTP server, and dispatches incoming requests into the Wasm sandbox. Your JavaScript runs inside the sandbox - isolated from the host filesystem and environment, except for what you explicitly allow via config.

```
┌─────────────────────────────────────────┐
│                kyu run                  │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │         Wasmtime (host)          │   │
│  │                                  │   │
│  │  ┌────────────────────────────┐  │   │
│  │  │   worker.wasm (sandbox)    │  │   │
│  │  │                            │  │   │
│  │  │  QuickJS + your JS code    │  │   │
│  │  └────────────────────────────┘  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
         ▲                    │
    HTTP request         HTTP response
```

Workers are stateless by design. Each request runs in isolation and module-level variables do not persist between requests.

## Install

```bash
curl -fsSL https://kyushu.dev/install | bash
```

Or download a pre-built binary from the [releases page](https://github.com/peterpeterparker/kyushu/releases).

## Quick start

**1. Write a worker**

```typescript
// src/index.ts
import type { ExportedHandler } from "kyushu-types";

export default {
  async fetch(request) {
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    };
  },
} satisfies ExportedHandler;
```

**2. Build**

```bash
kyu build
```

This produces `worker/__kyushu_worker.wasm`.

**3. Run**

```bash
kyu run
# Listening on http://0.0.0.0:5987
```

## TypeScript types

Install the types package for autocompletion:

```bash
npm install --save-dev kyushu-types
```

## API

Workers export a default object with a `fetch` handler:

```typescript
export default {
  async fetch(request: WorkerRequest): Promise<WorkerResponse> {
    // ...
  },
};
```

### `WorkerRequest`

| Field     | Type                                                     | Description                       |
| --------- | -------------------------------------------------------- | --------------------------------- |
| `method`  | `WorkerMethod`                                           | HTTP method (`GET`, `POST`, etc.) |
| `url`     | `string`                                                 | Full request URL                  |
| `headers` | `Record<string, string>` \| `undefined`                  | Request headers                   |
| `body`    | `string` \| `ArrayBuffer` \| `Uint8Array` \| `undefined` | Request body                      |

### `WorkerResponse`

| Field     | Type                                                     | Description                       |
| --------- | -------------------------------------------------------- | --------------------------------- |
| `status`  | `number` \| `undefined`                                  | HTTP status code (default: `200`) |
| `body`    | `string` \| `ArrayBuffer` \| `Uint8Array` \| `undefined` | Response body                     |
| `headers` | `Record<string, string>` \| `undefined`                  | Response headers                  |

## CLI reference

```
kyu build [config]   Bundle and pre-initialize a worker
kyu run [config]     Run a built worker
kyu --version        Print the CLI version
```

Both `build` and `run` accept an optional config file. Pass a path to override the defaults.

## Config reference

The available options and their defaults:

### Build

Configure the build step.

```toml
[build]
entry = "src/index.ts"            # default
outdir = "worker"                 # default
outfile = "__kyushu_worker.wasm"  # default
```

| Field     | Type   | Default                | Description                                       |
| --------- | ------ | ---------------------- | ------------------------------------------------- |
| `entry`   | string | `src/index.ts`         | Path to your TypeScript or JavaScript entry point |
| `outdir`  | string | `worker`               | Output directory for the built worker             |
| `outfile` | string | `__kyushu_worker.wasm` | Output filename for the built worker              |

### Run

Configure the runner.

```toml
[run]
wasm = "worker/__kyushu_worker.wasm"  # default
port = 5987                           # default

[[worker.mounts]]
host = "."
guest = "/"
writable = true

[[worker.env]]
key = "API_KEY"
value = "secret"
```

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

## Security

> [!CAUTION]
> Kyushu's sandbox is only as strong as its dependencies. Please read this before deploying anything sensitive.

Your JavaScript runs inside a [Wasmtime](https://wasmtime.io) WebAssembly sandbox, which provides strong isolation from the host system. Access to the filesystem and environment variables is gated by explicit configuration in the run config.

However, there are important caveats:

- **JavaScript polyfills**: The QuickJS runtime is extended with Node.js-compatible polyfills from the [wasm-rquickjs](https://github.com/nicolo-ribaudo/wasm-rquickjs) project, which implement Node.js APIs (`fs`, `crypto`, `http`, etc.) inside the Wasm sandbox. Their security properties have not been reviewed by this project, and it is unknown whether they have been independently audited. They are a third-party dependency and are used as-is.
- **Experimental status**: Kyushu itself has not been audited. The sandboxing boundaries, configuration parsing, and request handling are all early-stage code.

Use Kyushu for experimentation, local development, and learning. Do not expose it to untrusted input in production without a thorough review.

## Known Limitations

### Top-level `console.log`

Calls to `console.log` and other console methods at the top level of your worker module are silently swallowed. This is a side effect of Wizer pre-initialization: writing to stdout during snapshotting corrupts internal stdio state for the runtime. Only log starting from the `fetch` handler, not at module scope (which is ignored).

### Dynamic `import()` at Runtime

Some npm packages use dynamic `import()` internally as an escape hatch to avoid bundling certain dependencies:

```js
function importAtRuntime(specifier) {
  return import(specifier);
}
```

Bundlers intentionally leave these calls untouched, and Kyushu's Wasm sandbox has no Node.js module resolution at runtime — so they'll throw a `ReferenceError` when executed.

**Example:** `file-type`'s `fromFile` dynamically imports `strtok3` at runtime. Use `fromBuffer` instead:

```ts
// ❌
const fileType = await fileTypeFromFile(filepath);

// ✅
const file = await readFile(filepath);
const fileType = await fileTypeFromBuffer(file);
```

**Rule of thumb:** when a package offers separate Node.js vs. browser/edge APIs, prefer the browser/edge variant.

## License

MIT
