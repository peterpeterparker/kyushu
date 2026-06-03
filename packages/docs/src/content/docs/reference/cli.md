---
title: CLI
description: Reference for the kyu command line tool.
---

## kyu build

Bundle and pre-initialize a worker.

```bash
kyu build [config]
```

If no config path is provided, defaults are used. Pass an explicit path to override.

```bash
kyu build
kyu build path/to/kyushu.build.toml
```

## kyu run

Run a built worker.

```bash
kyu run [config]
```

If no config path is provided, defaults are used. Pass an explicit path to override.

```bash
kyu run
kyu run path/to/kyushu.run.toml
```

## kyu --version

Print the installed CLI version.

```bash
kyu --version
```
