use std::{env, path::PathBuf};

use crate::{common::Validator, shader_error::ShaderError};

mod dxc;
mod naga;
mod shader_error;
mod common;
mod server;

pub fn main() {
    server::run();
}
