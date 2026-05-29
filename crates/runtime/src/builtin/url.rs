use rquickjs::prelude::*;
use url::Url;

// Native functions for the URL implementation
#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::class::Trace;
    use rquickjs::convert::Coerced;
    use rquickjs::prelude::*;
    use rquickjs::{Ctx, Exception, JsLifetime, Value};
    use url::Url;

    #[derive(JsLifetime, Trace)]
    #[rquickjs::class(rename = "URL")]
    pub struct JsUrl {
        #[qjs(skip_trace)]
        url: Url,
    }

    #[rquickjs::methods(rename_all = "camelCase")]
    impl JsUrl {
        #[qjs(constructor)]
        pub fn new(
            url: Coerced<String>,
            base_url: Opt<Option<Coerced<String>>>,
            ctx: Ctx<'_>,
        ) -> rquickjs::Result<Self> {
            let url = url.0;
            let base = Opt(base_url.0.flatten().map(|c| c.0));

            match super::parse_url(url, base) {
                Ok(url) => Ok(Self { url }),
                Err(err) => Err(ctx.throw(
                    Exception::from_message(ctx.clone(), &format!("Invalid URL: {err}"))
                        .unwrap()
                        .into(),
                )),
            }
        }

        /// The hash property of the URL interface is a string containing a "#" followed by the fragment identifier of the URL.
        /// If the URL does not have a fragment identifier, this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "hash")]
        pub fn get_hash(&self) -> String {
            self.url
                .fragment()
                .map(|s| format!("#{s}"))
                .unwrap_or_default()
        }

        #[qjs(set, enumerable, rename = "hash")]
        pub fn set_hash(&mut self, value: Coerced<String>) {
            let value = value.0;
            if value.is_empty() {
                self.url.set_fragment(None);
            } else if let Some(s) = value.strip_prefix('#') {
                self.url.set_fragment(Some(s));
            } else {
                self.url.set_fragment(Some(&value));
            }
        }

        /// The host property of the URL interface is a string containing the host, which is the hostname, and then,
        /// if the port of the URL is nonempty, a ":", followed by the port of the URL.
        /// If the URL does not have a hostname, this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "host")]
        pub fn get_host(&self) -> String {
            if let Some(host) = self.url.host_str() {
                if let Some(port) = self.url.port() {
                    format!("{host}:{port}")
                } else {
                    host.to_string()
                }
            } else {
                String::new()
            }
        }

        #[qjs(set, enumerable, rename = "host")]
        pub fn set_host(&mut self, value: Coerced<String>, ctx: Ctx<'_>) -> rquickjs::Result<()> {
            let value = value.0;
            if value.is_empty() {
                let _ = self.url.set_host(None);
                Ok(())
            } else if let Some((host, port_str)) = value.rsplit_once(':') {
                if let Err(err) = self.url.set_host(Some(host)) {
                    Err(ctx.throw(
                        Exception::from_message(
                            ctx.clone(),
                            &format!("Failed to set URL host: {err}"),
                        )
                        .unwrap()
                        .into(),
                    ))
                } else if let Ok(port) = port_str.parse::<u16>() {
                    let _ = self.url.set_port(Some(port));
                    Ok(())
                } else {
                    Err(ctx.throw(
                        Exception::from_message(
                            ctx.clone(),
                            "Failed to set URL host: invalid port",
                        )
                        .unwrap()
                        .into(),
                    ))
                }
            } else if let Err(err) = self.url.set_host(Some(&value)) {
                Err(ctx.throw(
                    Exception::from_message(ctx.clone(), &format!("Failed to set URL host: {err}"))
                        .unwrap()
                        .into(),
                ))
            } else {
                Ok(())
            }
        }

        /// The hostname property of the URL interface is a string containing either the domain name or IP address of the URL.
        /// If the URL does not have a hostname, this property contains an empty string, "".
        /// IPv4 and IPv6 addresses are normalized, such as stripping leading zeros, and domain names are converted to IDN.
        #[qjs(get, enumerable, rename = "hostname")]
        pub fn get_hostname(&self) -> String {
            self.url
                .host_str()
                .map(|s| s.to_string())
                .unwrap_or_default()
        }

        #[qjs(set, enumerable, rename = "hostname")]
        pub fn set_hostname(
            &mut self,
            value: Coerced<String>,
            ctx: Ctx<'_>,
        ) -> rquickjs::Result<()> {
            let value = value.0;
            if let Err(err) = self.url.set_host(Some(&value)) {
                Err(ctx.throw(
                    Exception::from_message(
                        ctx.clone(),
                        &format!("Failed to set URL hostname: {err}"),
                    )
                    .unwrap()
                    .into(),
                ))
            } else {
                Ok(())
            }
        }

        // The href property of the URL interface is a string containing the whole URL.
        #[qjs(get, enumerable, rename = "href")]
        pub fn get_href(&self) -> String {
            self.url.to_string()
        }

        #[qjs(set, enumerable, rename = "href")]
        pub fn set_href(&mut self, value: Coerced<String>, ctx: Ctx<'_>) -> rquickjs::Result<()> {
            let value = value.0;
            match Url::parse(&value) {
                Ok(url) => {
                    self.url = url;
                    Ok(())
                }
                Err(err) => Err(Exception::throw_type(
                    &ctx,
                    &format!("Failed to set URL href: {err}"),
                )),
            }
        }

        #[qjs(get, enumerable, rename = "origin")]
        pub fn get_origin(&self) -> String {
            self.url.origin().unicode_serialization()
        }

        /// The password property of the URL interface is a string containing the password component of the URL.
        /// If the URL does not have a password, this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "password")]
        pub fn get_password(&self) -> String {
            self.url
                .password()
                .map(|s| s.to_string())
                .unwrap_or_default()
        }

        #[qjs(set, enumerable, rename = "password")]
        pub fn set_password(&mut self, value: Coerced<String>) {
            let value = value.0;
            if value.is_empty() {
                let _ = self.url.set_password(None);
            } else {
                let _ = self.url.set_password(Some(&value));
            }
        }

        /// The pathname property of the URL interface represents a location in a hierarchical structure.
        /// It is a string constructed from a list of path segments, each of which is prefixed by a / character.
        #[qjs(get, enumerable, rename = "pathname")]
        pub fn get_pathname(&self) -> String {
            self.url.path().to_string()
        }

        #[qjs(set, enumerable, rename = "pathname")]
        pub fn set_pathname(&mut self, value: Coerced<String>) {
            let value = value.0;
            self.url.set_path(&value);
        }

        /// The port property of the URL interface is a string containing the port number of the URL.
        /// If the port is the default for the protocol (80 for ws: and http:, 443 for wss: and https:, and 21 for ftp:),
        /// this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "port")]
        pub fn get_port(&self) -> String {
            self.url.port().map(|s| s.to_string()).unwrap_or_default()
        }

        #[qjs(set, enumerable, rename = "port")]
        pub fn set_port(&mut self, value: Coerced<String>, ctx: Ctx<'_>) -> rquickjs::Result<()> {
            let value = value.0;
            if value.is_empty() {
                let _ = self.url.set_port(None);
                Ok(())
            } else {
                match value.parse::<u16>() {
                    Ok(port) => {
                        let _ = self.url.set_port(Some(port));
                        Ok(())
                    }
                    Err(err) => Err(ctx.throw(
                        Exception::from_message(
                            ctx.clone(),
                            &format!("Failed to parse port: {err}"),
                        )
                        .unwrap()
                        .into(),
                    )),
                }
            }
        }

        /// The protocol property of the URL interface is a string containing the protocol or scheme of the URL, including the final ":".
        #[qjs(get, enumerable, rename = "protocol")]
        pub fn get_protocol(&self) -> String {
            format!("{}:", self.url.scheme())
        }

        #[qjs(set, enumerable, rename = "protocol")]
        pub fn set_protocol(&mut self, value: Coerced<String>) {
            let value = value.0;
            let _ = self.url.set_scheme(value.trim_end_matches(':'));
        }

        // The search property of the URL interface is a search string, also called a query string,
        // that is a string containing a "?" followed by the parameters of the URL.
        // If the URL does not have a search query, this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "search")]
        pub fn get_search(&self) -> String {
            self.url
                .query()
                .map(|s| format!("?{s}"))
                .unwrap_or_default()
        }

        #[qjs(set, enumerable, rename = "search")]
        pub fn set_search(&mut self, value: Coerced<String>) {
            let value = value.0;
            if value.is_empty() {
                self.url.set_query(None);
            } else if let Some(s) = value.strip_prefix('?') {
                self.url.set_query(Some(s));
            } else {
                self.url.set_query(Some(&value));
            }
        }

        /// The username property of the URL interface is a string containing the username component of the URL.
        /// If the URL does not have a username, this property contains an empty string, "".
        #[qjs(get, enumerable, rename = "username")]
        pub fn get_username(&self) -> String {
            self.url.username().to_string()
        }

        #[qjs(set, enumerable, rename = "username")]
        pub fn set_username(&mut self, value: Coerced<String>) {
            let value = value.0;
            let _ = self.url.set_username(&value);
        }

        #[qjs(rename = "toJSON")]
        pub fn to_json(&self) -> String {
            self.get_href()
        }

        #[qjs(rename = "toString")]
        #[allow(clippy::inherent_to_string)]
        pub fn to_string(&self) -> String {
            self.get_href()
        }

        #[qjs(static, rename = "canParse")]
        pub fn can_parse(url: Coerced<String>, base: Opt<Coerced<String>>) -> bool {
            let url = url.0;
            let base = Opt(base.0.map(|c| c.0));
            super::parse_url(url, base).is_ok()
        }

        #[qjs(static, rename = "createObjectURL")]
        pub fn create_object_url<'js>(
            object: Value<'js>,
            ctx: Ctx<'js>,
        ) -> rquickjs::Result<String> {
            if !object.is_object() {
                return Err(Exception::throw_type(
                    &ctx,
                    "The argument must be an instance of Blob",
                ));
            }
            let id = uuid::Uuid::new_v4().to_string();
            let url = format!("blob:nodedata:{id}");
            // Store the blob in a global registry
            let global = ctx.globals();
            let registry: rquickjs::Object<'js> = global
                .get::<_, rquickjs::Object>("__blobURLRegistry")
                .unwrap_or_else(|_| {
                    let obj = rquickjs::Object::new(ctx.clone()).unwrap();
                    global.set("__blobURLRegistry", obj.clone()).unwrap();
                    obj
                });
            registry.set(&url as &str, object)?;
            Ok(url)
        }

        #[qjs(static, rename = "parse")]
        pub fn parse(url: Coerced<String>, base: Opt<Coerced<String>>) -> Option<JsUrl> {
            let url = url.0;
            let base = Opt(base.0.map(|c| c.0));
            super::parse_url(url, base).map(|url| Self { url }).ok()
        }

        #[qjs(static, rename = "revokeObjectURL")]
        pub fn revoke_object_url(
            object_url: Coerced<String>,
            ctx: Ctx<'_>,
        ) -> rquickjs::Result<()> {
            let object_url = object_url.0;
            let global = ctx.globals();
            if let Ok(registry) = global.get::<_, rquickjs::Object>("__blobURLRegistry") {
                registry.set(
                    &object_url as &str,
                    rquickjs::Value::new_undefined(ctx.clone()),
                )?;
            }
            Ok(())
        }
    }
}

fn parse_url(raw_url: String, base: Opt<String>) -> Result<Url, String> {
    match Url::parse(&raw_url) {
        Ok(url) => {
            if url.scheme() != "" {
                Ok(url)
            } else {
                parse_url_with_base(raw_url, base.0, None)
            }
        }
        Err(err) => parse_url_with_base(raw_url, base.0, Some(err.to_string())),
    }
}

fn parse_url_with_base(
    url: String,
    base: Option<String>,
    err: Option<String>,
) -> Result<Url, String> {
    if let Some(base) = base {
        match Url::parse(&base) {
            Ok(base_url) => match base_url.join(&url) {
                Ok(url) => Ok(url),
                Err(err) => Err(format!("Failed to join URL with base URL: {err}")),
            },
            Err(err) => Err(format!("Failed to parse base URL: {err}")),
        }
    } else if let Some(err) = err {
        Err(format!("Failed to parse URL: {err}"))
    } else {
        Err("Missing base URL".to_string())
    }
}

// JS implementation: URLSearchParams polyfill + node:url APIs
pub const URL_JS: &str = include_str!("url.js");

// Re-export for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:url'; export { default } from 'node:url';"#;

// JS code wiring the URL module into the global context
pub const WIRE_JS: &str = r#"
        import { URL as __wasm_rquickjs_URL, URLSearchParams as __wasm_rquickjs_USP } from '__wasm_rquickjs_builtin/url';
        Object.defineProperty(globalThis, 'URL', {
            value: __wasm_rquickjs_URL,
            writable: true,
            enumerable: false,
            configurable: true,
        });
        Object.defineProperty(globalThis, 'URLSearchParams', {
            value: __wasm_rquickjs_USP,
            writable: true,
            enumerable: false,
            configurable: true,
        });
    "#;
