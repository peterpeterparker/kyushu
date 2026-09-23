#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::Ctx;

    #[cfg(feature = "typescript-runtime")]
    fn serialize_transform_result(
        ctx: &Ctx<'_>,
        result: Result<
            crate::internal::typescript::TypeScriptOutput,
            crate::internal::typescript::TypeScriptError,
        >,
    ) -> rquickjs::Result<String> {
        let output = match result {
            Ok(output) => output,
            Err(error) => {
                let constructor_name = match error.kind {
                    crate::internal::typescript::TypeScriptErrorKind::Error => "Error",
                    crate::internal::typescript::TypeScriptErrorKind::SyntaxError => "SyntaxError",
                };
                let constructor: rquickjs::Function<'_> = ctx.globals().get(constructor_name)?;
                let object: rquickjs::Object<'_> = constructor.call((error.message,))?;
                object.set("code", error.code)?;
                return Err(ctx.throw(object.into_value()));
            }
        };
        serde_json::to_string(&serde_json::json!({
            "code": output.code,
            "sourceMap": output.source_map,
        }))
        .map_err(|error| rquickjs::Exception::throw_message(ctx, &error.to_string()))
    }

    #[rquickjs::function]
    pub fn transform_typescript(
        ctx: Ctx<'_>,
        source: String,
        filename: String,
        mode: String,
        source_map: bool,
        module: Option<bool>,
    ) -> rquickjs::Result<String> {
        #[cfg(feature = "typescript-runtime")]
        {
            use crate::internal::typescript::TypeScriptMode;

            let mode = match mode.as_str() {
                "strip" => TypeScriptMode::Strip,
                "transform" => TypeScriptMode::Transform,
                _ => {
                    return Err(rquickjs::Exception::throw_range(
                        &ctx,
                        "invalid TypeScript mode",
                    ));
                }
            };
            serialize_transform_result(
                &ctx,
                crate::internal::typescript::transform(source, &filename, mode, source_map, module),
            )
        }
        #[cfg(not(feature = "typescript-runtime"))]
        {
            let _ = (source, filename, mode, source_map, module);
            Err(rquickjs::Exception::throw_message(
                &ctx,
                "TypeScript runtime support is not enabled",
            ))
        }
    }

    #[rquickjs::function]
    pub fn transform_typescript_module(
        ctx: Ctx<'_>,
        source: String,
        filename: String,
        module: Option<bool>,
    ) -> rquickjs::Result<String> {
        #[cfg(feature = "typescript-runtime")]
        {
            serialize_transform_result(
                &ctx,
                crate::internal::typescript::transform_module(source, &filename, false, module),
            )
        }
        #[cfg(not(feature = "typescript-runtime"))]
        {
            let _ = (source, filename, module);
            Err(rquickjs::Exception::throw_message(
                &ctx,
                "TypeScript runtime support is not enabled",
            ))
        }
    }

    #[rquickjs::function]
    pub fn test_observability_enabled() -> bool {
        cfg!(feature = "test-observability")
    }
}
