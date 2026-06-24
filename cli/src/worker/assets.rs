use crate::assets::Asset;
use wasmtime::component::Val;

pub struct WorkerAssets(Vec<Asset>);

impl From<Vec<Asset>> for WorkerAssets {
    fn from(assets: Vec<Asset>) -> Self {
        Self(assets)
    }
}

impl WorkerAssets {
    pub fn to_val(&self) -> Val {
        let vals = self
            .0
            .iter()
            .map(|asset| {
                Val::Record(vec![
                    ("path".to_string(), Val::String(asset.path.clone().into())),
                    (
                        "bytes".to_string(),
                        Val::List(asset.bytes.iter().map(|bytes| Val::U8(*bytes)).collect()),
                    ),
                    (
                        "mime-type".to_string(),
                        Val::Option(
                            asset
                                .mime_type
                                .as_ref()
                                .map(|m| Box::new(Val::String(m.clone().into()))),
                        ),
                    ),
                ])
            })
            .collect();

        Val::Option(Some(Box::new(Val::List(vals))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::Asset;

    fn make_asset(path: &str, bytes: Vec<u8>, mime_type: Option<&str>) -> Asset {
        Asset {
            path: path.to_string(),
            bytes,
            mime_type: mime_type.map(|m| m.to_string()),
        }
    }

    #[test]
    fn test_to_val_empty() {
        let assets = WorkerAssets::from(vec![]);
        let val = assets.to_val();
        assert!(matches!(val, Val::Option(Some(_))));
    }

    #[test]
    fn test_to_val_is_option_of_list() {
        let assets = WorkerAssets::from(vec![make_asset(
            "/index.html",
            b"<html>".to_vec(),
            Some("text/html"),
        )]);
        let val = assets.to_val();
        match val {
            Val::Option(Some(inner)) => assert!(matches!(*inner, Val::List(_))),
            _ => panic!("expected Val::Option(Some(Val::List(...)))"),
        }
    }

    #[test]
    fn test_to_val_list_length() {
        let assets = WorkerAssets::from(vec![
            make_asset("/index.html", b"<html>".to_vec(), Some("text/html")),
            make_asset(
                "/app.js",
                b"console.log()".to_vec(),
                Some("application/javascript"),
            ),
        ]);
        match assets.to_val() {
            Val::Option(Some(inner)) => match *inner {
                Val::List(list) => assert_eq!(list.len(), 2),
                _ => panic!("expected Val::List"),
            },
            _ => panic!("expected Val::Option"),
        }
    }

    #[test]
    fn test_from_vec() {
        let assets = WorkerAssets::from(vec![make_asset("/index.html", vec![], None)]);
        assert_eq!(assets.0.len(), 1);
    }
}
