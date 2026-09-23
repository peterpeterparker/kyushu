use futures::future::{AbortHandle, Abortable};
use rquickjs::function::This;
use rquickjs::{Ctx, Persistent, Value};

pub(crate) async fn with_abort_signal<'js, F, T>(
    ctx: &Ctx<'js>,
    signal: Option<Value<'js>>,
    future: F,
) -> rquickjs::Result<T>
where
    F: Future<Output = rquickjs::Result<T>>,
{
    let signal = match signal {
        Some(signal) if !signal.is_undefined() && !signal.is_null() => signal,
        _ => return future.await,
    };
    let signal = rquickjs::Object::from_value(signal)?;
    if signal.get::<_, bool>("aborted")? {
        return Err(ctx.throw(signal.get::<_, Value<'js>>("reason")?));
    }

    let add: rquickjs::Function<'js> = signal.get("addEventListener")?;
    let remove: rquickjs::Function<'js> = signal.get("removeEventListener")?;
    let (handle, registration) = AbortHandle::new_pair();
    let callback = rquickjs::Function::new(ctx.clone(), move || handle.abort())?;
    let options = rquickjs::Object::new(ctx.clone())?;
    options.set("once", true)?;
    add.call::<_, ()>((This(signal.clone()), "abort", callback.clone(), options))?;

    if signal.get::<_, bool>("aborted")? {
        let _ = remove.call::<_, ()>((This(signal.clone()), "abort", callback));
        return Err(ctx.throw(signal.get::<_, Value<'js>>("reason")?));
    }

    let signal = Persistent::save(ctx, signal);
    let callback = Persistent::save(ctx, callback);
    let remove = Persistent::save(ctx, remove);
    let result = Abortable::new(future, registration).await;
    let signal = signal.restore(ctx)?;
    let callback = callback.restore(ctx)?;
    let remove = remove.restore(ctx)?;
    let _ = remove.call::<_, ()>((This(signal.clone()), "abort", callback));

    match result {
        Ok(result) => result,
        Err(_) => Err(ctx.throw(signal.get::<_, Value<'js>>("reason")?)),
    }
}
