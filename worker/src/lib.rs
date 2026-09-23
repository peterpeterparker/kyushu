#[allow(warnings)]
mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "kyushu:worker/worker",
        generate_all,
    });
}
mod handler;
mod runtime;
mod setup;
mod types;

use bindings::exports::wasi::http::handler::Guest as HttpGuest;
use bindings::wasi::http::types::{ErrorCode, Request, Response};

struct Worker;

impl bindings::Guest for Worker {
    fn wizer_initialize() {
        setup::initialize();
    }

    fn kyu_initialize() {
        setup::initialize();
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
