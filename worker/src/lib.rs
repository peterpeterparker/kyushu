#[allow(warnings)]
mod bindings;
mod handler;
mod runtime;
mod setup;
mod types;

use bindings::exports::wasi::http::incoming_handler::Guest as HttpGuest;
use bindings::wasi::http::types::{IncomingRequest, ResponseOutparam};

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
    fn handle(request: IncomingRequest, response_out: ResponseOutparam) {
        handler::handle(request, response_out);
    }
}

bindings::export!(Worker with_types_in bindings);
