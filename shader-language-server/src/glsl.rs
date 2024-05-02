use std::path::Path;
use crate::{shader_error::{ShaderError, ShaderErrorList, ShaderErrorSeverity}, common::{Validator, ShaderTree}};
use glsl::{parser::Parse, visitor::Host};
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
        return Err(ShaderErrorList::from(ShaderError::ValidationErr { emitted: errors.to_string(), src: String::from("") }));
    }
}
impl Validator for Glsl {
    fn validate_shader(&mut self, path: &Path) -> Result<(), ShaderErrorList> {
        let shader = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;

        let parse_result = ShaderStage::parse(shader);
        match parse_result {
            Ok(ast) => Ok(()),
            Err(error) => match Glsl::parse_errors(&error.to_string()) {
                Ok(error_list) => Err(error_list),
                Err(error_list) => Err(error_list)
            }
        }
    }

    fn get_shader_tree(&mut self, path: &Path) -> Result<ShaderTree, ShaderErrorList> {
        let mut types = Vec::new();
        let mut global_variables = Vec::new();
        let mut functions = Vec::new();

        Ok(ShaderTree {
            types,
            global_variables,
            functions,
        })
    }
}
