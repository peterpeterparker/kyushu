use rquickjs::{ArrayBuffer, Ctx, FromJs, IntoJs, Object, Result as JsResult, TypedArray, Value};
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Head => "HEAD",
            HttpMethod::Options => "OPTIONS",
        };
        write!(f, "{}", s)
    }
}

impl From<&str> for HttpMethod {
    fn from(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "POST" => HttpMethod::Post,
            "PUT" => HttpMethod::Put,
            "PATCH" => HttpMethod::Patch,
            "DELETE" => HttpMethod::Delete,
            "HEAD" => HttpMethod::Head,
            "OPTIONS" => HttpMethod::Options,
            _ => HttpMethod::Get,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    Text(String),
    Bytes(Vec<u8>),
}

impl Body {
    pub fn into_bytes(self) -> Vec<u8> {
        match self {
            Body::Text(s) => s.into_bytes(),
            Body::Bytes(b) => b,
        }
    }
}

impl<'js> IntoJs<'js> for Body {
    fn into_js(self, ctx: &Ctx<'js>) -> JsResult<Value<'js>> {
        match self {
            Body::Text(s) => s.into_js(ctx),
            Body::Bytes(b) => Ok(ArrayBuffer::new(ctx.clone(), b)?.into_value()),
        }
    }
}

impl<'js> FromJs<'js> for Body {
    fn from_js(ctx: &Ctx<'js>, value: Value<'js>) -> JsResult<Self> {
        if value.is_string() {
            Ok(Body::Text(String::from_js(ctx, value)?))
        } else if let Ok(buf) = ArrayBuffer::from_js(ctx, value.clone()) {
            Ok(Body::Bytes(buf.as_bytes().unwrap_or_default().to_vec()))
        } else {
            let typed: TypedArray<u8> = TypedArray::from_js(ctx, value)?;
            Ok(Body::Bytes(typed.as_bytes().unwrap_or_default().to_vec()))
        }
    }
}

pub struct JsRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: Option<Vec<(String, String)>>,
    pub body: Option<Body>,
}

impl<'js> IntoJs<'js> for JsRequest {
    fn into_js(self, ctx: &Ctx<'js>) -> JsResult<Value<'js>> {
        let obj = Object::new(ctx.clone())?;
        obj.set("method", self.method.to_string())?;
        obj.set("url", self.url)?;

        if let Some(headers) = self.headers {
            let headers_obj = Object::new(ctx.clone())?;
            for (k, v) in headers {
                headers_obj.set(k, v)?;
            }
            obj.set("headers", headers_obj)?;
        }

        if let Some(body) = self.body {
            obj.set("body", body)?;
        }

        Ok(obj.into_value())
    }
}

pub struct JsResponse {
    pub status: u16,
    pub body: Option<Body>,
    pub headers: Vec<(String, String)>,
}

impl<'js> FromJs<'js> for JsResponse {
    fn from_js(_ctx: &Ctx<'js>, value: Value<'js>) -> JsResult<Self> {
        let obj = Object::from_value(value)?;
        let status: u16 = obj.get("status").unwrap_or(200);
        let body: Option<Body> = obj.get::<_, Body>("body").ok();

        let headers = if let Ok(headers_obj) = obj.get::<_, Object>("headers") {
            headers_obj
                .props::<String, String>()
                .filter_map(|r| r.ok())
                .collect()
        } else {
            vec![]
        };

        Ok(Self {
            status,
            body,
            headers,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rquickjs::{ArrayBuffer, Context, Runtime};

    #[test]
    fn test_http_method_display() {
        assert_eq!(HttpMethod::Get.to_string(), "GET");
        assert_eq!(HttpMethod::Post.to_string(), "POST");
        assert_eq!(HttpMethod::Delete.to_string(), "DELETE");
    }

    #[test]
    fn test_http_method_from_str() {
        assert_eq!(HttpMethod::from("GET"), HttpMethod::Get);
        assert_eq!(HttpMethod::from("post"), HttpMethod::Post);
        assert_eq!(HttpMethod::from("UNKNOWN"), HttpMethod::Get);
    }

    #[test]
    fn test_js_request_into_js_text_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let request = JsRequest {
                method: HttpMethod::Get,
                url: "http://localhost/api".to_string(),
                headers: Some(vec![(
                    "content-type".to_string(),
                    "application/json".to_string(),
                )]),
                body: Some(Body::Text("hello".to_string())),
            };
            let val = request.into_js(&ctx).unwrap();
            let obj = Object::from_value(val).unwrap();
            assert_eq!(obj.get::<_, String>("method").unwrap(), "GET");
            assert_eq!(obj.get::<_, String>("url").unwrap(), "http://localhost/api");
            assert_eq!(obj.get::<_, String>("body").unwrap(), "hello");
        });
    }

    #[test]
    fn test_js_request_into_js_binary_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let request = JsRequest {
                method: HttpMethod::Post,
                url: "http://localhost/api".to_string(),
                headers: None,
                body: Some(Body::Bytes(vec![1, 2, 3])),
            };
            let val = request.into_js(&ctx).unwrap();
            let obj = Object::from_value(val).unwrap();
            let buf = obj.get::<_, ArrayBuffer>("body").unwrap();
            assert_eq!(buf.as_bytes().unwrap(), &[1u8, 2, 3]);
        });
    }

    #[test]
    fn test_js_response_from_js_text_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let obj = Object::new(ctx.clone()).unwrap();
            obj.set("status", 200u16).unwrap();
            obj.set("body", "hello world").unwrap();
            let response = JsResponse::from_js(&ctx, obj.into_value()).unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(response.body, Some(Body::Text("hello world".to_string())));
        });
    }

    #[test]
    fn test_js_response_from_js_arraybuffer_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let obj = Object::new(ctx.clone()).unwrap();
            obj.set("status", 200u16).unwrap();
            let buf = ArrayBuffer::new(ctx.clone(), vec![1, 2, 3]).unwrap();
            obj.set("body", buf).unwrap();
            let response = JsResponse::from_js(&ctx, obj.into_value()).unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(response.body, Some(Body::Bytes(vec![1, 2, 3])));
        });
    }

    #[test]
    fn test_js_response_from_js_uint8array_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let obj = Object::new(ctx.clone()).unwrap();
            obj.set("status", 200u16).unwrap();
            let typed = TypedArray::<u8>::new(ctx.clone(), vec![1, 2, 3]).unwrap();
            obj.set("body", typed).unwrap();
            let response = JsResponse::from_js(&ctx, obj.into_value()).unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(response.body, Some(Body::Bytes(vec![1, 2, 3])));
        });
    }

    #[test]
    fn test_js_response_no_body() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let obj = Object::new(ctx.clone()).unwrap();
            obj.set("status", 204u16).unwrap();
            let response = JsResponse::from_js(&ctx, obj.into_value()).unwrap();
            assert_eq!(response.status, 204);
            assert_eq!(response.body, None);
        });
    }

    #[test]
    fn test_js_request_no_body_no_headers() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            let request = JsRequest {
                method: HttpMethod::Get,
                url: "http://localhost/".to_string(),
                headers: None,
                body: None,
            };
            let val = request.into_js(&ctx).unwrap();
            let obj = Object::from_value(val).unwrap();
            assert!(obj.get::<_, String>("body").is_err());
            assert!(obj.get::<_, Object>("headers").is_err());
        });
    }
}
