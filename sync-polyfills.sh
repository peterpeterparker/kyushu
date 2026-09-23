#!/bin/bash

SKELETON="/Users/daviddalbusco/projects/lab/wasm-rquickjs/crates/wasm-rquickjs/skeleton/src"
DEST="crates/runtime/src"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SKELETON"/* "$DEST/"