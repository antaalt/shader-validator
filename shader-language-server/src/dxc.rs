use hassle_rs::*;
use std::{ffi::OsStr, path::Path};

use crate::{shader_error::{ShaderErrorList, ShaderError, ShaderErrorSeverity}, common::{ShaderTree, Validator}};

pub struct Dxc {
    compiler: hassle_rs::DxcCompiler,
    library: hassle_rs::DxcLibrary,
    
    validator: Option<hassle_rs::DxcValidator>,
    dxil: Option<hassle_rs::wrapper::Dxil>,

    #[allow(dead_code)] // Need to keep dxc alive while dependencies created
    dxc: hassle_rs::wrapper::Dxc,
}

struct IncludeHandler {}

impl hassle_rs::wrapper::DxcIncludeHandler for IncludeHandler {
    fn load_source(&mut self, filename: String) -> Option<String> {
        use std::io::Read;
        match std::fs::File::open(filename) {
            Ok(mut f) => {
                let mut content = String::new();
                f.read_to_string(&mut content).ok()?;
                Some(content)
            }
            Err(_) => None,
        }
    }
}

impl From<hassle_rs::HassleError> for ShaderErrorList {
    fn from(error: hassle_rs::HassleError) -> Self {
        
        match error {
            HassleError::CompileError(err) => match Dxc::parse_dxc_errors(&err) {
                Ok(error_list) => error_list,
                Err(error_list) => error_list,
            },
            //HassleError::ValidationError(err) => ShaderErrorList::from(ShaderError::ValidationErr { src: err.to_string(), error: (), emitted: err }),
            HassleError::LibLoadingError(err) => ShaderErrorList::internal(err.to_string()),
            HassleError::LoadLibraryError { filename, inner } => ShaderErrorList::internal(format!("Failed to load library {}: {}", filename.display(), inner.to_string())),
            HassleError::Win32Error(err) => ShaderErrorList::internal(format!("Win32 error: HRESULT={}", err)),
            HassleError::WindowsOnly(err) => ShaderErrorList::internal(format!("Windows only error: {}", err)),
            err => ShaderErrorList::internal(err.to_string())
        }
    }
}

impl Dxc {
    pub fn new() -> Result<Self, hassle_rs::HassleError> {
        let dxc = hassle_rs::Dxc::new(None)?;
        let library = dxc.create_library()?;
        let compiler = dxc.create_compiler()?;
        // TODO: check dxil.dll exist or it will fail. Just return Ok if it does not exist.
        //#[cfg(target_os = "windows")]
        let dxil = Dxil::new(None)?;
        let validator = dxil.create_validator()?;
        Ok(Self {
            dxc,
            compiler,
            library,
            dxil: Some(dxil),
            validator: Some(validator),
        })
    }
    fn parse_dxc_errors(errors: &String) -> Result<ShaderErrorList, ShaderErrorList>
    {
        let mut shader_error_list = ShaderErrorList::empty();

        let reg = regex::Regex::new(r"(?m)^(.*?:\d+:\d+: .*:.*?)$")?;
        let mut starts = Vec::new();
        for capture in reg.captures_iter(errors.as_str()) {
            starts.push(capture.get(0).unwrap().start());
        }
        starts.push(errors.len());
        let internal_reg = regex::Regex::new(r"(?s)^(.*?):(\d+):(\d+): (.*?):(.*)")?;
        for start in 0..starts.len()-1 {
            let first = starts[start];
            let length = starts[start + 1] - starts[start];
            let block : String = errors.chars().skip(first).take(length).collect();
            if let Some(capture) = internal_reg.captures(block.as_str()) {
                //let filename = capture.get(1).map_or("", |m| m.as_str());
                let line = capture.get(2).map_or("", |m| m.as_str());
                let pos = capture.get(3).map_or("", |m| m.as_str());
                let level = capture.get(4).map_or("", |m| m.as_str());
                let msg = capture.get(5).map_or("", |m| m.as_str());
                shader_error_list.push(ShaderError::ParserErr {
                    severity: match level {
                        "error" => ShaderErrorSeverity::Error,
                        "warning" => ShaderErrorSeverity::Warning,
                        "note" => ShaderErrorSeverity::Information,
                        "hint" => ShaderErrorSeverity::Hint,
                        _ => ShaderErrorSeverity::Error,
                    },
                    error: String::from(msg),
                    line: line.parse::<usize>().unwrap_or(0),
                    pos: pos.parse::<usize>().unwrap_or(0),
                });
            }
        }

        // TODO: should probably not assert or crash...
        assert!(shader_error_list.errors.len() > 0);
        return Ok(shader_error_list);
    }
}
impl Validator for Dxc {
    fn validate_shader(&mut self, path: &Path) -> Result<(), ShaderErrorList> {

        let source = std::fs::read_to_string(path)?;

        let path_name = path.file_name().unwrap_or(&OsStr::new("shader.hlsl"));
        let path_name_str = path_name.to_str().unwrap_or("shader.hlsl");

        let blob = self.library.create_blob_with_encoding_from_str(&source)?;

        let result = self.compiler.compile(
            &blob,
            path_name_str,
            "",
            "lib_6_5",
            &[],
            Some(&mut IncludeHandler{}),
            &[],
        );

        match result {
            Ok(dxc_result) => {
                let result_blob = dxc_result.get_result()?;
                // Skip validation if dxil.dll does not exist.
                if self.dxil.is_some() && self.validator.is_some() {
                    let data = result_blob.to_vec();
                    let blob_encoding = self.library.create_blob_with_encoding(data.as_ref())?;

                    match self.validator.as_ref().unwrap().validate(blob_encoding.into()) {
                        Ok(_) => {
                            Ok(())
                        }
                        Err(dxc_err) => {
                            let error_blob = dxc_err.0.get_error_buffer()?;
                            let error_emitted = self.library.get_blob_as_string(&error_blob.into())?;
                            Err(ShaderErrorList::internal(format!("Validation failed: {}", error_emitted)))
                        }
                    }
                } else {
                    Ok(())
                }
            }
            Err((dxc_result, _hresult)) => {
                let error_blob = dxc_result.get_error_buffer()?;
                Err(ShaderErrorList::from(HassleError::CompileError(
                    self.library.get_blob_as_string(&error_blob.into())?,
                )))
            }
        }
    }

    fn get_shader_tree(&mut self, path: &Path) -> Result<ShaderTree, ShaderErrorList> {

        let types = Vec::new();
        let global_variables = Vec::new();
        let functions = Vec::new();

        let source = std::fs::read_to_string(path)?;

        let path_name = path.file_name().unwrap_or(&OsStr::new("shader.hlsl"));
        let path_name_str = path_name.to_str().unwrap_or("shader.hlsl");

        let blob = self.library.create_blob_with_encoding_from_str(&source)?;

        let result = self.compiler.compile(
            &blob,
            path_name_str,
            "",
            "lib_6_5",
            &[],
            Some(&mut IncludeHandler{}),
            &[],
        );

        match result {
            Ok(dxc_result) => {
                let result_blob = dxc_result.get_result()?;
                let data = result_blob.to_vec();
                let blob_encoding = self.library.create_blob_with_encoding(data.as_ref())?;
                let reflector = self.dxc.create_reflector()?;
                let reflection = reflector.reflect(blob_encoding.into())?;
                // Hassle capabilities on this seems limited for now...
                // Would need to create a PR to add interface for other API.
                reflection.thread_group_size();
                
                Ok(ShaderTree {
                    types,
                    global_variables,
                    functions,
                })
            }
            Err((_dxc_result, _hresult)) => Err(ShaderErrorList::internal(String::from("Failed to get reflection data from shader")))
        }
    }
}
