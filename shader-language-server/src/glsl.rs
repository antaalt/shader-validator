use std::path::Path;
use crate::{shader_error::{ShaderError, ShaderErrorList, ShaderErrorSeverity}, common::{Validator, ShaderTree}};
use glsl::parser::Parse;
use glsl::syntax::ShaderStage;
pub struct Glsl {
}

impl Glsl {
    pub fn new() -> Self {
        Self {
            
        }
    }
}
impl Glsl {
    fn parse_errors(errors: &String) -> Result<ShaderErrorList, ShaderErrorList>
    {
        let mut shader_error_list = ShaderErrorList::empty();

        let reg = regex::Regex::new(r"(?m)^(.*?: \d+: at line \d+):$")?;
        let mut starts = Vec::new();
        for capture in reg.captures_iter(errors.as_str()) {
            starts.push(capture.get(0).unwrap().start());
        }
        starts.push(errors.len());
        let internal_reg = regex::Regex::new(r"(?s)^(.*?): (\d+): at line (\d+):(.+)")?;
        for start in 0..starts.len()-1 {
            let first = starts[start];
            let length = starts[start + 1] - starts[start];
            let block : String = errors.chars().skip(first).take(length).collect();
            if let Some(capture) = internal_reg.captures(block.as_str()) {
                let level = capture.get(1).map_or("", |m| m.as_str());
                let _error_index = capture.get(2).map_or("", |m| m.as_str());
                let line = capture.get(3).map_or("", |m| m.as_str());
                let msg = capture.get(4).map_or("", |m| m.as_str());
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
                    pos: 0, // Could we retrieve pos ?
                });
            }
            else 
            {
                shader_error_list.push(ShaderError::InternalErr(format!("Failed to parse regex: {}", block)));
            }
        }
        return Ok(shader_error_list);
    }
}
impl Validator for Glsl {
    fn validate_shader(&mut self, path: &Path) -> Result<(), ShaderErrorList> {
        let shader = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;

        let parse_result = ShaderStage::parse(shader);
        match parse_result {
            Ok(_ast) => Ok(()),
            Err(error) => match Glsl::parse_errors(&error.to_string()) {
                Ok(error_list) => Err(error_list),
                Err(error_list) => Err(error_list)
            }
        }
    }

    fn get_shader_tree(&mut self, path: &Path) -> Result<ShaderTree, ShaderErrorList> {
        let _shader = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;
        let types = Vec::new();
        let global_variables = Vec::new();
        let functions = Vec::new();

        Ok(ShaderTree {
            types,
            global_variables,
            functions,
        })
    }
}
