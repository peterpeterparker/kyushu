//! Runtime spine for the generated rquickjs component.
//!
//! This is a single skeleton that supports two generation targets selected by a
//! Cargo feature flag:
//!
//! * `p2` (default) — the historical WASI Preview 2 path: synchronous exports
//!   driven by `wstd::block_on`, the full Node.js builtin set, resource tables and
//!   Wizer pre-initialization. Implemented in [`p2`].
//! * `p3` — the opt-in WASI Preview 3 path: `async` exports/imports driven directly
//!   on the component-model async executor, depending only on `rquickjs` and
//!   `wasip3` (no `wstd`, no `wasip2`, no P2 pollables). Implemented in [`p3`].
//!
//! Exactly one of the two features must be enabled. The generated code always
//! refers to `crate::internal::*`, so each target re-exports the public surface its
//! generated code expects.

#[cfg(all(feature = "p2", feature = "p3"))]
compile_error!(
    "features `p2` and `p3` are mutually exclusive; enable exactly one WASI generation target"
);

#[cfg(not(any(feature = "p2", feature = "p3")))]
compile_error!(
    "enable exactly one of the `p2` or `p3` features to select the WASI generation target"
);

pub(crate) mod module_loading;
pub(crate) mod runtime_services;
#[cfg(feature = "typescript-runtime")]
pub(crate) mod typescript;
pub(crate) use module_loading::{
    mark_node_package_deprecation_warning_seen, node_package_deprecation_warning_seen,
};

#[cfg(feature = "p2")]
mod p2;
#[cfg(feature = "p2")]
pub use p2::*;

#[cfg(feature = "p3")]
mod p3;
#[cfg(feature = "p3")]
pub use p3::*;
