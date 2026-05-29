FROM rust:slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    llvm-dev \
    libclang-dev \
    clang \
    cmake \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install cargo-component --locked
RUN cargo install wasm-tools --locked

WORKDIR /app

COPY . .

RUN cargo component build --target wasm32-wasip2 -p kyushu-worker --release

# We use the local component for testing. The Dockerfile is not used to release the CLI.
RUN cargo build -p kyushu-cli --release --features local-worker

FROM scratch AS export

COPY --from=builder /app/target/wasm32-wasip2/release/kyushu_worker.wasm /
COPY --from=builder /app/target/release/kyu /