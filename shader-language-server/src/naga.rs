use naga::{
    front::wgsl::{self, ParseError},
    valid::{Capabilities, ValidationFlags},
};
use std::path::Path;

use crate::{shader_error::{ShaderError, ShaderErrorList, ShaderErrorSeverity}, common::{Validator, ShaderTree}};

pub struct Naga {
    validator: naga::valid::Validator,
}

impl Naga {
    pub fn new() -> Self {
        Self {
            validator: naga::valid::Validator::new(ValidationFlags::all(), Capabilities::all()),
        }
    }
    fn from_parse_err(err: ParseError, src: &str) -> ShaderError {
        let error = err.emit_to_string(src);
        let loc = err.location(src);
        if let Some(loc) = loc {
            ShaderError::ParserErr {
                severity: ShaderErrorSeverity::Error,
                error,
                line: loc.line_number as usize,
                pos: loc.line_position as usize,
            }
        } else {
            ShaderError::ParserErr {
                severity: ShaderErrorSeverity::Error,
                error,
                line: 0,
                pos: 0,
            }
        }
    }
}
impl Validator for Naga {
    fn validate_shader(&mut self, path: &Path) -> Result<(), ShaderErrorList> {
        let shader = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;
        let module =
            wgsl::parse_str(&shader).map_err(|err| Self::from_parse_err(err, &shader))?;

        if let Err(error) = self.validator.validate(&module) {
            Err(ShaderErrorList::from(ShaderError::ValidationErr { emitted: error.emit_to_string(&shader), src: shader, error }))
        } else {
            Ok(())
        }
    }

    fn get_shader_tree(&mut self, path: &Path) -> Result<ShaderTree, ShaderErrorList> {
        let shader = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;
        let module =
            wgsl::parse_str(&shader).map_err(|err| Self::from_parse_err(err, &shader))?;

        let mut types = Vec::new();
        let mut global_variables = Vec::new();
        let mut functions = Vec::new();

        for (_, ty) in module.types.iter() {
            if let Some(name) = &ty.name {
                types.push(name.clone())
            }
        }

        for (_, var) in module.global_variables.iter() {
            if let Some(name) = &var.name {
                global_variables.push(name.clone())
            }
        }

        for (_, f) in module.functions.iter() {
            if let Some(name) = &f.name {
                functions.push(name.clone())
            }
        }

        Ok(ShaderTree {
            types,
            global_variables,
            functions,
        })
    }
}
