#![allow(warnings)]

// Empty file, to be generated

pub mod builtin;
pub mod internal;
mod modules;
pub mod wrappers;

static JS_EXPORT_MODULE_NAME: &str = "bundle/script_module";
static JS_EXPORT_MODULE_SOURCE: &str = include_str!("bundle_script_module.js");

// We patch js_export_module so that the developer JS code can be registered at Wizer
// pre-init time before the runtime is initialized. That way, the app does not have to
// be imported on every handler request but globalThis.userModule can be used instead,
// which allows for declaring persistent state at the root of the JS module
// (e.g. a response cache in the static file server).
static _EXPORT_MODULE: std::sync::LazyLock<std::sync::Mutex<Option<GetModuleFn>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

pub fn set_export_module(get_module: GetModuleFn) {
    *_EXPORT_MODULE.lock().unwrap() = Some(get_module);
}

fn js_export_module() -> &'static str {
    if let Ok(module) = _EXPORT_MODULE.lock() {
        if let Some(module) = module.as_ref() {
            return Box::leak(module().into_boxed_str());
        }
    }

    JS_EXPORT_MODULE_SOURCE
}

type GetModuleFn = Box<dyn (Fn() -> String) + Send + Sync>;

// We patch JS_ADDITIONAL_MODULES to allow consumers to register additional modules at Wizer
// pre-init time before the runtime is initialized.
static JS_ADDITIONAL_MODULES: std::sync::LazyLock<Vec<(&'static str, GetModuleFn)>> =
    std::sync::LazyLock::new(|| _PENDING_MODULES.lock().unwrap().drain(..).collect());

static _PENDING_MODULES: std::sync::LazyLock<std::sync::Mutex<Vec<(&'static str, GetModuleFn)>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

pub fn add_additional_module(name: &'static str, get_module: GetModuleFn) {
    _PENDING_MODULES.lock().unwrap().push((name, get_module));
}
