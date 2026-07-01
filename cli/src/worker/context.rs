use crate::config::{EnvConfig, MountConfig, NetworkConfig};
use crate::worker::state::WorkerState;
use anyhow::Result;
use wasmtime::component::ResourceTable;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxBuilder};
use wasmtime_wasi_http::WasiHttpCtx;

pub struct WorkerContext {
    table: ResourceTable,
    wasi: WasiCtxBuilder,
    http: WasiHttpCtx,
}

impl WorkerContext {
    pub fn new() -> Self {
        Self {
            table: ResourceTable::new(),
            wasi: WasiCtx::builder(),
            http: WasiHttpCtx::new(),
        }
    }

    pub fn inherit_stdio(mut self) -> Self {
        self.wasi.inherit_stdout().inherit_stderr();
        self
    }

    fn with_env(mut self, key: &str, val: &str) -> Self {
        self.wasi.env(key, val);
        self
    }

    fn with_mount(mut self, host: &str, guest: &str, writable: bool) -> Result<Self> {
        let (dir_perms, file_perms) = if writable {
            (DirPerms::all(), FilePerms::all())
        } else {
            (DirPerms::READ, FilePerms::READ)
        };
        self.wasi
            .preopened_dir(host, guest, dir_perms, file_perms)?;
        Ok(self)
    }

    pub fn with_mounts(mut self, mounts: Option<&Vec<MountConfig>>) -> Result<Self> {
        if let Some(mounts) = mounts {
            for mount in mounts {
                self = self.with_mount(&mount.host, &mount.guest, mount.writable)?;
            }
        }
        Ok(self)
    }

    pub fn with_envs(mut self, envs: Option<&Vec<EnvConfig>>) -> Self {
        if let Some(envs) = envs {
            for env in envs {
                self = self.with_env(&env.key, &env.value);
            }
        }
        self
    }

    pub fn with_network(mut self, network: Option<&NetworkConfig>) -> Self {
        if let Some(network) = network {
            self.wasi
                .allow_ip_name_lookup(network.ip_name_lookup)
                .allow_tcp(network.tcp)
                .allow_udp(network.udp);
        }
        self
    }

    pub fn build(mut self) -> WorkerState {
        WorkerState {
            table: self.table,
            wasi: self.wasi.build(),
            http: self.http,
        }
    }
}
