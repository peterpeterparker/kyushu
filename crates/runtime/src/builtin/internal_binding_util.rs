#[rquickjs::module(rename = "camelCase")]
pub mod native_module {
    use rquickjs::{Array, Ctx, FromJs, Promise, Value, promise::PromiseState, qjs};

    #[rquickjs::function]
    pub fn get_proxy_details<'js>(
        ctx: Ctx<'js>,
        value: Value<'js>,
        full_proxy: Option<bool>,
    ) -> rquickjs::Result<Value<'js>> {
        if !unsafe { qjs::JS_IsProxy(value.as_raw()) } {
            return Ok(Value::new_undefined(ctx));
        }

        let full_proxy = full_proxy.unwrap_or(true);
        let target = get_proxy_target_or_null(&ctx, &value);

        if !full_proxy {
            return Ok(target);
        }

        let result = Array::new(ctx.clone())?;
        if target.is_null() {
            result.set(0, Value::new_null(ctx.clone()))?;
            result.set(1, Value::new_null(ctx))?;
            return Ok(result.into_value());
        }

        let handler = get_proxy_handler_or_null(&ctx, &value);
        result.set(0, target)?;
        result.set(1, handler)?;
        Ok(result.into_value())
    }

    #[rquickjs::function]
    pub fn get_promise_details<'js>(
        ctx: Ctx<'js>,
        value: Value<'js>,
    ) -> rquickjs::Result<Value<'js>> {
        let promise = Promise::from_js(&ctx, value)?;

        let (state, result) = match promise.state() {
            PromiseState::Pending => (0, Value::new_undefined(ctx.clone())),
            PromiseState::Resolved => {
                let resolved = match promise.result::<Value<'js>>() {
                    Some(Ok(value)) => value,
                    _ => Value::new_undefined(ctx.clone()),
                };
                (1, resolved)
            }
            PromiseState::Rejected => {
                let _ = promise.result::<Value<'js>>();
                let rejected = ctx.catch();
                (2, rejected)
            }
        };

        let details = Array::new(ctx.clone())?;
        details.set(0, state)?;
        details.set(1, result)?;
        Ok(details.into_value())
    }

    fn get_proxy_target_or_null<'js>(ctx: &Ctx<'js>, proxy: &Value<'js>) -> Value<'js> {
        let raw = unsafe { qjs::JS_GetProxyTarget(ctx.as_raw().as_ptr(), proxy.as_raw()) };
        value_or_null(ctx, raw)
    }

    fn get_proxy_handler_or_null<'js>(ctx: &Ctx<'js>, proxy: &Value<'js>) -> Value<'js> {
        let raw = unsafe { qjs::JS_GetProxyHandler(ctx.as_raw().as_ptr(), proxy.as_raw()) };
        value_or_null(ctx, raw)
    }

    fn value_or_null<'js>(ctx: &Ctx<'js>, raw: qjs::JSValue) -> Value<'js> {
        if unsafe { qjs::JS_IsException(raw) } {
            clear_pending_exception(ctx);
            return Value::new_null(ctx.clone());
        }

        unsafe { Value::from_raw(ctx.clone(), raw) }
    }

    fn clear_pending_exception(ctx: &Ctx<'_>) {
        let raw_exception = unsafe { qjs::JS_GetException(ctx.as_raw().as_ptr()) };
        unsafe {
            qjs::JS_FreeValue(ctx.as_raw().as_ptr(), raw_exception);
        }
    }
}
