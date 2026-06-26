use crate::runtime::assets::state::{ASSETS, Asset};
use rquickjs::{
    Ctx, Error as JsError, IntoJs, Object, Result as JsResult, String as JsString, TypedArray,
    Value,
};

pub struct JsAsset<'js> {
    pub bytes: TypedArray<'js, u8>,
    pub mime_type: Option<String>,
}

impl<'js> IntoJs<'js> for JsAsset<'js> {
    fn into_js(self, ctx: &Ctx<'js>) -> JsResult<Value<'js>> {
        let obj = Object::new(ctx.clone())?;
        obj.set("bytes", self.bytes)?;
        obj.set("mimeType", self.mime_type)?;
        Ok(obj.into_value())
    }
}

impl<'js> JsAsset<'js> {
    pub fn from_asset(ctx: &Ctx<'js>, asset: &Asset) -> JsResult<Self> {
        Ok(Self {
            bytes: TypedArray::new(ctx.clone(), asset.bytes.as_slice())?,
            mime_type: asset.mime_type.clone(),
        })
    }
}

pub fn init_get_asset(ctx: &Ctx) -> Result<(), JsError> {
    ctx.globals().set("__kyushu_get_asset__", js_get_asset)?;

    Ok(())
}

#[rquickjs::function]
fn get_asset<'js>(ctx: Ctx<'js>, path: String) -> JsResult<Option<JsAsset<'js>>> {
    let Some(assets) = ASSETS.get() else {
        return Err(ctx.throw(JsString::from_str(ctx.clone(), "No assets configured")?.into()));
    };

    let Some(asset) = assets.iter().find(|a| a.path == path) else {
        return Ok(None);
    };

    Ok(Some(JsAsset::from_asset(&ctx, asset)?))
}
