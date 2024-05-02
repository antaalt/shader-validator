use std::io::{BufRead, Read};
use std::{io, path::PathBuf};
use std::str::FromStr;

use crate::common::Validator;
use crate::dxc::Dxc;
use crate::naga::Naga;
use crate::shader_error::ShaderErrorList;
use crate::common::ShadingLanguage;
use crate::shader_error::ShaderErrorSeverity;

use jsonrpc_core::{IoHandler, Params, Value};

use serde::{Deserialize, Serialize};

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
struct ValidateFileParams {
    path: PathBuf,
    shadingLanguage: String,
}

#[derive(Debug, Serialize, Deserialize)]
enum ValidateFileError {
    ParserErr {
        severity: String,
        error: String,
        scopes: Vec<String>,
        line: usize,
        pos: usize,
    },
    ValidationErr {
        message: String,
        debug: String,
    },
    UnknownError(String),
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
struct ValidateFileResponse {
    IsOk: bool,
    Messages: Vec<ValidateFileError>,
}

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
struct Quit {
}

impl ValidateFileResponse {
    fn ok() -> Self {
        Self {
            IsOk: true,
            Messages: Vec::new()
        }
    }
    fn error(error_list: &ShaderErrorList) -> Self {
        use crate::shader_error::ShaderError;
        let mut errors = Vec::new();
        for error in &error_list.errors {
            errors.push(match error {
                ShaderError::ParserErr { severity, error, line, pos } => {
                    ValidateFileError::ParserErr {
                        severity: severity.to_string(),
                        error: error.clone(),
                        scopes: vec![],
                        line: *line,
                        pos: *pos,
                    }
                }
                ShaderError::ValidationErr { src, error, .. } => {
                    if let Some((span, _)) = error.spans().next() {
                        let loc = span.location(&src);
                        ValidateFileError::ParserErr {
                            severity: ShaderErrorSeverity::Error.to_string(),
                            error: format!("{}.\n\n{:#?}", error, error),
                            scopes: vec![],
                            line: loc.line_number as usize,
                            pos: loc.line_position as usize,
                        }
                    } else {
                        ValidateFileError::ValidationErr {
                            message: format!("{}.\n\n{:#?}", error, error),
                            debug: format!("{:#?}", error),
                        }
                    }
                }
                err => ValidateFileError::UnknownError(format!("{:#?}", err)),
            });
        }
        Self {
            IsOk: false,
            Messages: errors
        }
    }
}

pub fn run() {
    let mut handler = IoHandler::new();
    handler.add_sync_method("get_file_tree", move|params: Params| {
        let params: ValidateFileParams = params.parse()?;
            
        let shading_language_parsed = ShadingLanguage::from_str(params.shadingLanguage.as_str());
        let shading_language = match shading_language_parsed {
            Ok(res) => res,
            Err(_) => { return Err(jsonrpc_core::Error::invalid_params(format!("Invalid shading language: {}", params.shadingLanguage))); }
        };

        let mut validator : Box<dyn Validator> = match shading_language {
            ShadingLanguage::Wgsl => Box::new(Naga::new()),
            ShadingLanguage::Hlsl => Box::new(Dxc::new().expect("Failed to create DXC"))
        };

        let tree = validator.get_shader_tree(&params.path).ok();

        Ok(serde_json::to_value(tree).unwrap())
    });

    handler.add_sync_method("validate_file", move |params: Params| {
        let params: ValidateFileParams = params.parse()?;
        
        let shading_language_parsed = ShadingLanguage::from_str(params.shadingLanguage.as_str());
        let shading_language = match shading_language_parsed {
            Ok(res) => res,
            Err(()) => { return Err(jsonrpc_core::Error::invalid_params(format!("Invalid shading language: {}", params.shadingLanguage))); }
        };

        let mut validator : Box<dyn Validator> = match shading_language {
            ShadingLanguage::Wgsl => Box::new(Naga::new()),
            ShadingLanguage::Hlsl => Box::new(Dxc::new().expect("Failed to create DXC"))
        };

        let res = match validator.validate_shader(&params.path) {
            Ok(_) => ValidateFileResponse::ok(),
            Err(err) => ValidateFileResponse::error(&err)
        };
        Ok(serde_json::to_value(res).unwrap())
    });
    handler.add_sync_method("quit", move|_params: Params| {
        //let params: Quit = params.parse()?;
        Ok(serde_json::from_str("{}").unwrap())
    });

    loop {
        for req in io::stdin().lock().lines() {
            println!("Received something...");
            if let Some(rsp) = handler.handle_request_sync(&req.unwrap()) {
                // Send response to stdio
                if rsp == "{}" {
                    break;
                }
                println!("{}", rsp);
            }
        }
    }
}
