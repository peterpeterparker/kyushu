#!/bin/bash

set -e

echo "Building worker source..."
RUSTFLAGS="" LDFLAGS="" cargo component build --target wasm32-wasip2 -p kyushu-worker

echo "Building cli source..."
cargo build -p kyushu-cli --features local-worker

echo "Building demo..."
./target/debug/kyu build examples/kyushu.build.toml

echo "Starting demo..."
./target/debug/kyu run examples/kyushu.run.toml

# Test
# curl -X POST http://localhost:5987/api \
#   -H "content-type: application/json" \
#   -H "x-custom: hello" \
#   -d '{"name": "kyushu"}'