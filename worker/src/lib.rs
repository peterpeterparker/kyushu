#[allow(warnings)]
mod bindings {
    wit_bindgen_p3::generate!({
        path: "wit",
        world: "kyushu:worker/worker",
        runtime_path: "wit_bindgen_p3::rt",
        generate_all,
    });
}
mod handler;
mod response;
mod runtime;
mod setup;
mod types;

use bindings::exports::wasi::http::handler::Guest as HttpGuest;
use bindings::wasi::http::types::{ErrorCode, Request, Response};

struct Worker;

impl bindings::Guest for Worker {
    async fn wizer_initialize() {
        setup::initialize().await;
    }

    async fn kyu_initialize() {
        setup::initialize().await;
    }

    fn kyu_version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

impl HttpGuest for Worker {
    async fn handle(request: Request) -> Result<Response, ErrorCode> {
        handler::handle(request).await
    }
}

bindings::export!(Worker with_types_in bindings);
