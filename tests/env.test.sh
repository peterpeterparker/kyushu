#!/bin/bash

set -e

echo "Building worker..."
./target/release/kyu build tests/fixtures/env/kyushu.src.toml

echo "Starting runner..."
./target/release/kyu run tests/fixtures/env/kyushu.run.toml &
KYU_PID=$!

trap "kill $KYU_PID 2>/dev/null" EXIT

echo "Waiting for runner..."
for i in $(seq 1 100); do
    nc -z localhost 5987 2>/dev/null && break
    sleep 0.1
done

echo "Testing..."
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:5987/api)
STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$STATUS" != "200" ]; then
    echo "❌ Status failed: got $STATUS"
    exit 1
fi

if ! echo "$BODY" | grep -q "secret"; then
    echo "❌ Body missing expected content"
    exit 1
fi

echo "✅ Integration test passed"