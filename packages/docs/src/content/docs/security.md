---
title: Security
description: Security considerations and caveats for Kyushu.
---

Your JavaScript runs inside a [Wasmtime](https://wasmtime.io) WebAssembly sandbox, which provides strong isolation from the host system. Access to the filesystem and environment variables is gated by explicit configuration in the run config.

But a sandbox is only as strong as its dependencies. Please read this before deploying anything sensitive.

:::caution
Use Kyushu for experimentation, local development, and learning. Do not expose it to untrusted input in production without a thorough review.
:::

## JavaScript polyfills

The QuickJS runtime is extended with Node.js-compatible polyfills from the [wasm-rquickjs](https://github.com/nicolo-ribaudo/wasm-rquickjs) project, which implement Node.js APIs (`fs`, `crypto`, `http`, etc.) inside the Wasm sandbox. Their security properties have not been reviewed by this project, and it is unknown whether they have been independently audited. They are a third-party dependency and are used as-is.

## Experimental status

Kyushu itself has not been audited. The sandboxing boundaries, configuration parsing, and request handling are all early-stage code.
