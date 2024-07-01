use std::path::Path;
use crate::{shader_error::{ShaderError, ShaderErrorList, ShaderErrorSeverity}, common::{Validator, ShaderTree}};
use glslang::{error::GlslangError, Compiler, CompilerOptions, ShaderInput, ShaderSource};
use glslang::*;

impl From<regex::Error> for ShaderErrorList {
    fn from(error: regex::Error) -> Self {
        match error {
            regex::Error::CompiledTooBig(err) => ShaderErrorList::internal(format!("Regex compile too big: {}", err)),
            regex::Error::Syntax(err) => ShaderErrorList::internal(format!("Regex syntax invalid: {}", err)),
            err =>  ShaderErrorList::internal(format!("Regex error: {:#?}", err))
        }
    }
}

pub struct Glsl {
}

impl Glsl {
    pub fn new() -> Self {
        Self {
            
        }
    }
}
impl From<GlslangError> for ShaderErrorList {
    fn from(err: GlslangError) -> Self {
        match err {
            GlslangError::PreprocessError(error) => {
                match Glsl::parse_errors(&error) {
                    Ok(err) => err,
                    Err(err) => err
                }
            },
            GlslangError::ParseError(error) => {
                match Glsl::parse_errors(&error) {
                    Ok(err) => err,
                    Err(err) => err
                }
            },
            GlslangError::LinkError(error) => {
                match Glsl::parse_errors(&error) {
                    Ok(err) => err,
                    Err(err) => err
                }
            },
            GlslangError::ShaderStageNotFound(stage) => {
                ShaderErrorList::from(ShaderError::ValidationErr{ src: String::from(""), emitted: format!("Shader stage not found: {:#?}", stage)})
            },
            GlslangError::InvalidProfile(target, value, profile) => {
                ShaderErrorList::internal(format!("Invalid profile {} for target {:#?}: {:#?}", value, target, profile))
            },
            GlslangError::VersionUnsupported(value, profile) => {
                ShaderErrorList::internal(format!("Unsupported profile {}: {:#?}", value, profile))
            },
            err => ShaderErrorList::internal(format!("{:#?}", err))
        }
    }
}
impl Glsl {
    fn parse_errors(errors: &String) -> Result<ShaderErrorList, ShaderErrorList>
    {
        let mut shader_error_list = ShaderErrorList::empty();

        let reg = regex::Regex::new(r"(?m)^(.*?: \d+:\d+:)")?;
        let mut starts = Vec::new();
        for capture in reg.captures_iter(errors.as_str()) {
            starts.push(capture.get(0).unwrap().start());
        }
        starts.push(errors.len());
        let internal_reg = regex::Regex::new(r"(?m)^(.*?): (\d+):(\d+):(.+)")?;
        for start in 0..starts.len()-1 {
            let first = starts[start];
            let length = starts[start + 1] - starts[start];
            let block : String = errors.chars().skip(first).take(length).collect();
            if let Some(capture) = internal_reg.captures(block.as_str()) {
                let level = capture.get(1).map_or("", |m| m.as_str());
                // Pos seems to always be zero because of GLSLang...
                // https://github.com/KhronosGroup/glslang/issues/3238
                let _str = capture.get(2).map_or("", |m| m.as_str());
                let line = capture.get(3).map_or("", |m| m.as_str());
                let pos = capture.get(4).map_or("", |m| m.as_str());
                let msg = capture.get(5).map_or("", |m| m.as_str());
                shader_error_list.push(ShaderError::ParserErr {
                    severity: match level {
                        "ERROR" => ShaderErrorSeverity::Error,
                        "WARNING" => ShaderErrorSeverity::Warning,
                        "NOTE" => ShaderErrorSeverity::Information,
                        "HINT" => ShaderErrorSeverity::Hint,
                        _ => ShaderErrorSeverity::Error,
                    },
                    error: String::from(msg),
                    line: line.parse::<usize>().unwrap_or(1),
                    pos: pos.parse::<usize>().unwrap_or(0),
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
        let shader_string = std::fs::read_to_string(&path).map_err(ShaderErrorList::from)?;

        let compiler = Compiler::acquire().unwrap();
        let source = ShaderSource::try_from(shader_string).expect("Failed to read from source");


        let input = ShaderInput::new(
            &source,
            ShaderStage::Fragment,
            &CompilerOptions {
                source_language: SourceLanguage::GLSL,
                // Should have some settings to select these.
                target: Target::Vulkan { 
                    version: VulkanVersion::Vulkan1_3, 
                    spirv_version: SpirvVersion::SPIRV1_6 
                },
                messages: ShaderMessage::CASCADING_ERRORS | ShaderMessage::DEBUG_INFO,
                ..Default::default()
            },
            None,
        )?;
        let _shader = Shader::new(&compiler, input)?;
        
        Ok(())
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
