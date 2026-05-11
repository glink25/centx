use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WebManifest {
    pub web_version: String,
    pub min_native_version: String,
    pub built_against_native: String,
    pub url: String,
    pub sha256: String,
    pub signature: String,
    #[serde(default)]
    pub notes: String,
}
