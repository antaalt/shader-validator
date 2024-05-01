use std::{env, path::PathBuf};

use crate::{common::Validator, shader_error::ShaderError};

mod dxc;
mod naga;
mod shader_error;
mod common;

pub fn main() {
    let mut naga = naga::Naga::new();

    // WASI filesystem required you to mount folder to a virtual filesystem for security reasons.
    // /test is mounted from extension to point to test folder
    let path = PathBuf::from("/test/wgsl/type_error.wgsl");
    let result = naga.validate_shader(path.as_path());
    if result.is_err() {
        println!("Shader {} has errors:", path.display());
        let errors = result.unwrap_err();
        for error in errors.errors
        {
            match error
            {
                ShaderError::ValidationErr { src:_, error, emitted:_ } => {
                    println!("Validation error: {}", error);
                },
                ShaderError::ParserErr { severity:_, error, line:_, pos:_ } => {
                    println!("Parser error: {}", error);
                },
                ShaderError::IoErr(error) => {
                    println!("Io error: {}", error);
                }
                ShaderError::InternalErr(error) => {
                    println!("Internal error: {}", error);
                }
            }
        }
    }
    else
    {
        println!("Shader {} is OK ?", path.display());
    }
}
