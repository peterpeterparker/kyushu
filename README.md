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

**The runner** (`kyu run`) is a Rust binary powered by [Wasmtime](https://wasmtime.io). It loads your built worker, spins up an HTTP server, and dispatches incoming requests into the Wasm sandbox. Your JavaScript runs inside the sandbox - isolated from the host filesystem and network, except for what you explicitly allow via config.

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

**2. Create a build config**

```toml
# kyushu.build.toml
entry = "src/index.ts"
outdir = "dist"
```

**3. Build**

```bash
kyu build
```

This produces `dist/__kyushu_worker.wasm`.

**4. Create a run config**

```toml
# kyushu.run.toml
[worker]
wasm = "dist/__kyushu_worker.wasm"
port = 5987

[[mounts]]
host = "."
guest = "/"
writable = true

[[env]]
key = "API_KEY"
value = "secret"
```

**5. Run**

```bash
kyu run
# Listening on http://0.0.0.0:5987
```

## TypeScript types

Install the types package for autocompletion:

```bash
npm install --save-dev kyushu-types
```

## Config reference

### `kyushu.build.toml` - build config

| Field    | Type   | Description                                       |
| -------- | ------ | ------------------------------------------------- |
| `entry`  | string | Path to your TypeScript or JavaScript entry point |
| `outdir` | string | Output directory for the built worker             |

### `kyushu.run.toml` - run config

| Field               | Type   | Description                                         |
| ------------------- | ------ | --------------------------------------------------- |
| `worker.wasm`       | string | Path to the built worker `.wasm` file               |
| `worker.port`       | number | Port to listen on (default: `5987`)                 |
| `mounts`            | array  | Filesystem mounts to expose to the worker           |
| `mounts[].host`     | string | Path on the host filesystem                         |
| `mounts[].guest`    | string | Path inside the worker sandbox                      |
| `mounts[].writable` | bool   | Whether the mount is writable (default to readonly) |
| `env`               | array  | Environment variables to expose to the worker       |
| `env[].key`         | string | Environment variable name                           |
| `env[].value`       | string | Environment variable value                          |

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

## Security

> [!CAUTION]
> Kyushu's sandbox is only as strong as its dependencies. Please read this before deploying anything sensitive.

Your JavaScript runs inside a [Wasmtime](https://wasmtime.io) WebAssembly sandbox, which provides strong isolation from the host system. Access to the filesystem and environment variables is gated by explicit configuration in `kyushu.run.toml`.

However, there are important caveats:

- **JavaScript polyfills**: The QuickJS runtime is extended with Node.js-compatible polyfills from the [wasm-rquickjs](https://github.com/nicolo-ribaudo/wasm-rquickjs) project (Apache 2.0). These polyfills have not been independently audited for security. They are a third-party dependency and are used as-is.
- **No review of polyfill internals**: The polyfills implement Node.js APIs (`fs`, `crypto`, `http`, etc.) inside the Wasm sandbox. Their correctness and security properties have not been reviewed by the Kyushu project.
- **Experimental status**: Kyushu itself has not been audited. The sandboxing boundaries, configuration parsing, and request handling are all early-stage code.

Use Kyushu for experimentation, local development, and learning. Do not expose it to untrusted input in production without a thorough review.

## CLI reference

```
kyu build <config>   Bundle and pre-initialize a worker
kyu run <config>     Run a built worker
kyu --version        Print the CLI version
```

If no config is provided, `kyu build` looks for `kyushu.build.toml` and kyu run looks for `kyushu.run.toml`. Pass an explicit path to override.

## Known Limitations

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
