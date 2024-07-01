use std::path::Path;

use glslang::{Compiler, CompilerOptions, ShaderInput, ShaderSource};
use glslang::*;

use crate::{shader_error::ShaderErrorList, common::{ShaderTree, Validator}};

pub struct Hlsl {
}

impl Hlsl {
    pub fn new() -> Self {
        Self {
        }
    }
}
impl Validator for Hlsl {
    fn validate_shader(&mut self, path: &Path) -> Result<(), ShaderErrorList> {
        let shader_string = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;

        let compiler = Compiler::acquire().unwrap();
        let source = ShaderSource::try_from(shader_string).expect("Failed to read from source");

        let input = ShaderInput::new(
            &source,
            ShaderStage::Fragment,
            &CompilerOptions {
                source_language: SourceLanguage::HLSL,
                // Should have some settings to select these.
                target: Target::None(Some(SpirvVersion::SPIRV1_6)),
                messages: ShaderMessage::CASCADING_ERRORS | ShaderMessage::DEBUG_INFO,
                ..Default::default()
            },
            None,
        )?;
        let _shader = Shader::new(&compiler, input)?;

        Ok(())
    }

    fn get_shader_tree(&mut self, _path: &Path) -> Result<ShaderTree, ShaderErrorList> {

        Err(ShaderErrorList::empty())
    }
}
