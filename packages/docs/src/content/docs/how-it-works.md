---
title: How It Works
description: How Kyushu builds and runs JavaScript workers in a WebAssembly sandbox.
---

Kyushu has two moving parts: the worker and the runner.

## The worker

When you run `kyu build`, your TypeScript or JavaScript entry point is bundled and pre-initialized into a self-contained WebAssembly binary. The resulting `.wasm` file contains your code frozen in memory, ready to handle requests with no startup overhead.

## The runner

`kyu run` loads your built worker and starts an HTTP server. When a request arrives, it is dispatched into the Wasm sandbox. Your JavaScript runs isolated from the host filesystem and environment, except for what you explicitly allow via config.

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

## Stateless execution

Workers are stateless by design. Each request runs in isolation and module-level variables do not persist between requests.

## Isolation

Your worker runs inside a sandbox. It has no access to the host filesystem or environment variables unless you explicitly grant it via the run config. This isolation is enforced by the Wasm runtime, not by the operating system or a container.
