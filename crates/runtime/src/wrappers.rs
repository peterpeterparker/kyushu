use rquickjs::function::Args;
use rquickjs::{Ctx, FromJs, IntoJs, Object, Value};

pub const TAG: &str = "tag";
pub const VALUE: &str = "val";
const RESULT_OK: &str = "ok";
const RESULT_ERR: &str = "err";

/// rquickjs supports passing tuples as arguments but only up to 8 elements. This wrapper
/// provides support up to 26 elements.
#[allow(dead_code)]
pub struct JsArgs<T>(pub T);

macro_rules! impl_into_args {
    ($($t:ident),*) => {
        #[allow(non_snake_case)]
        impl<'js $(,$t)*> rquickjs::function::IntoArgs<'js> for JsArgs<($($t,)*)>
        where
            $($t : rquickjs::function::IntoArg<'js>,)*
        {
            fn num_args(&self) -> usize{
                let ($(ref $t,)*) = *&self.0;
                0 $(+ $t.num_args())*
            }

            fn into_args(self, _args: &mut Args<'js>) -> rquickjs::Result<()>{
                let ($($t,)*) = self.0;
                $($t.into_arg(_args)?;)*
                Ok(())
            }
        }
    };
}

impl_into_args!();
impl_into_args!(A);
impl_into_args!(A, B);
impl_into_args!(A, B, C);
impl_into_args!(A, B, C, D);
impl_into_args!(A, B, C, D, E);
impl_into_args!(A, B, C, D, E, F);
impl_into_args!(A, B, C, D, E, F, G);
impl_into_args!(A, B, C, D, E, F, G, H);
impl_into_args!(A, B, C, D, E, F, G, H, I);
impl_into_args!(A, B, C, D, E, F, G, H, I, J);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S);
impl_into_args!(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U
);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V
);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W
);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X
);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y
);
impl_into_args!(
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z
);

/// Wrapper for `Result` for implementing `IntoJs` and `FromJs` traits.
///
/// The Result is encoded in an object with two fields:
/// - `tag`: a string that is either "ok" or "err", indicating the result type.
/// - `val`: the value of the result, which can be either the success value or the error value.
#[allow(dead_code)]
pub struct JsResult<Ok, Err>(pub Result<Ok, Err>);

impl<'js, Ok: IntoJs<'js>, Err: IntoJs<'js>> IntoJs<'js> for JsResult<Ok, Err> {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        let obj = Object::new(ctx.clone())?;
        match self.0 {
            Ok(ok) => {
                obj.set(TAG, RESULT_OK)?;
                obj.set(VALUE, ok.into_js(ctx)?)?;
            }
            Err(err) => {
                obj.set(TAG, RESULT_ERR)?;
                obj.set(VALUE, err.into_js(ctx)?)?;
            }
        }
        Ok(obj.into_value())
    }
}

impl<'js, Ok: FromJs<'js>, Err: FromJs<'js>> FromJs<'js> for JsResult<Ok, Err> {
    fn from_js(_ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let obj = Object::from_value(value)?;
        let tag: String = obj.get(TAG)?;
        match tag.as_str() {
            RESULT_OK => {
                let val: Ok = obj.get(VALUE)?;
                Ok(JsResult(Ok(val)))
            }
            RESULT_ERR => {
                let val: Err = obj.get(VALUE)?;
                Ok(JsResult(Err(val)))
            }
            _ => Err(rquickjs::Error::new_from_js_message(
                "JS result object",
                "WIT result type",
                format!("Unknown tag: {tag}"),
            )),
        }
    }
}

// Wrapper type that forces the js type to be a bigint instead of the default number which can loose some bits due to
#[allow(dead_code)]
pub struct BigIntWrapper<T>(pub T);

impl<'js> IntoJs<'js> for BigIntWrapper<u64> {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        let bigint = rquickjs::BigInt::from_u64(ctx.clone(), self.0)?;
        Ok(Value::from_big_int(bigint))
    }
}

impl<'js> IntoJs<'js> for BigIntWrapper<i64> {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        let bigint = rquickjs::BigInt::from_i64(ctx.clone(), self.0)?;
        Ok(Value::from_big_int(bigint))
    }
}

impl<'js> FromJs<'js> for BigIntWrapper<u64> {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let bigint = rquickjs::BigInt::from_js(ctx, value)?;
        let i64_value = bigint.to_i64()?;
        Ok(BigIntWrapper(i64_value as u64))
    }
}

impl<'js> FromJs<'js> for BigIntWrapper<i64> {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let bigint = rquickjs::BigInt::from_js(ctx, value)?;
        let i64_value = bigint.to_i64()?;
        Ok(BigIntWrapper(i64_value))
    }
}

#[allow(dead_code)]
pub struct UInt8Array(pub Vec<u8>);

impl<'js> IntoJs<'js> for UInt8Array {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        let array = rquickjs::TypedArray::new_copy(ctx.clone(), self.0)?;
        Ok(array.into_value())
    }
}

impl<'js> FromJs<'js> for UInt8Array {
    fn from_js(_ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Self> {
        let array = rquickjs::TypedArray::<'js, u8>::from_value(value)?;
        Ok(UInt8Array(
            array
                .as_bytes()
                .expect("the UInt8Array passed to decode is detached")
                .to_vec(),
        ))
    }
}
