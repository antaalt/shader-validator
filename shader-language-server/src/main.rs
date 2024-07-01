#[cfg(not(target_os = "wasi"))]
mod dxc;
#[cfg(target_os = "wasi")]
mod hlsl;

mod naga;
mod glsl;
mod shader_error;
mod common;
mod server;

pub fn main() {
    server::run();
}
