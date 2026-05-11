use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
pub struct WebOtaState {
    pub active_version: Option<String>,
    pub previous_version: Option<String>,
    pub pending_version: Option<String>,
    #[serde(default)]
    pub trial_launches: u32,
}

impl WebOtaState {
    pub fn load(root: &Path) -> Self {
        let path = state_path(root);
        match fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, root: &Path) -> std::io::Result<()> {
        fs::create_dir_all(root)?;
        let path = state_path(root);
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&body)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)
    }
}

pub fn state_path(root: &Path) -> PathBuf {
    root.join("state.json")
}
