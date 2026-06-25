macro_rules! asset_method {
    ($instance:expr, $name:expr, |$asset:ident, $results:ident| $body:expr) => {
        $instance.func_new_async($name, move |mut store, _types, params, results| {
            Box::new(async move {
                if let Some(Val::Resource(r)) = params.get(0) {
                    let resource = Resource::<Asset>::try_from_resource_any(*r, &mut store)?;
                    let $asset = store.data().table.get(&resource)?;
                    let $results = results;
                    $body
                }
                Ok(())
            })
        })?;
    };
}
