mod dxc;
mod naga;
mod glsl;
mod shader_error;
mod common;
mod server;

pub fn main() {
    server::run();
}
