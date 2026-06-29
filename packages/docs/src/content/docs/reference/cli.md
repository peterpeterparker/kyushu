---
title: CLI
description: Reference for the kyu command line tool.
---

## kyu build

Bundle and pre-initialize a worker.

```bash
kyu build [config]
```

If no config path is provided, `kyu` looks for a `kyushu.toml` in the current directory and falls back to defaults if none is found.

```bash
kyu build
kyu build path/to/kyushu.toml
```

## kyu run

Run a built worker.

```bash
kyu run [config]
```

If no config path is provided, defaults are used. Pass an explicit path to override.

```bash
kyu run
kyu run path/to/kyushu.toml
```

## kyu dev

Start a local development server with live reload.

```bash
kyu dev [config]
```

If no config path is provided, defaults are used. Pass an explicit path to override.

```bash
kyu dev
kyu dev path/to/kyushu.toml
```

## kyu --version

Print the installed CLI version.

```bash
kyu --version
```
