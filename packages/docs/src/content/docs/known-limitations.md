---
title: Known Limitations
description: Current limitations and workarounds for Kyushu workers.
---

## Top-level `console.log`

Calls to `console.log` and other console methods at the top level of your worker module are silently swallowed. This is a side effect of Wizer pre-initialization: writing to stdout during snapshotting corrupts internal stdio state for the runtime. Only log starting from the `fetch` handler, not at module scope (which is ignored).

## Dynamic `import()` at runtime

Some npm packages use dynamic `import()` internally as an escape hatch to avoid bundling certain dependencies:

```js
function importAtRuntime(specifier) {
  return import(specifier);
}
```

Bundlers intentionally leave these calls untouched, and Kyushu's Wasm sandbox has no Node.js module resolution at runtime, so they will throw a `ReferenceError` when executed.

**Example:** `file-type`'s `fromFile` dynamically imports `strtok3` at runtime. Use `fromBuffer` instead:

```ts
// Not supported
const fileType = await fileTypeFromFile(filepath);

// Use this instead
const file = await readFile(filepath);
const fileType = await fileTypeFromBuffer(file);
```

**Rule of thumb:** when a package offers separate Node.js vs. browser/edge APIs, prefer the browser/edge variant.
