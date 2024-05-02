use core::fmt;

use naga::{valid::ValidationError, WithSpan};

#[derive(Debug)]
pub enum ShaderErrorSeverity {
    Error,
    Warning,
    Information,
    Hint,
}
impl fmt::Display for ShaderErrorSeverity {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ShaderErrorSeverity::Error => write!(f, "error"),
            ShaderErrorSeverity::Warning => write!(f, "warning"),
            ShaderErrorSeverity::Information => write!(f, "info"),
            ShaderErrorSeverity::Hint => write!(f, "hint"),
        }
    }
}

#[derive(Debug)]
pub enum ShaderError {
    ValidationErr {
        src: String,
        emitted: String,
    },
    ParserErr {
        severity: ShaderErrorSeverity,
        error: String,
        line: usize,
        pos: usize,
    },
    IoErr(std::io::Error),
    InternalErr(String)
}
#[derive(Debug)]
pub struct ShaderErrorList {
    pub errors: Vec<ShaderError>
}

impl From<std::io::Error> for ShaderErrorList {
    fn from(err: std::io::Error) -> Self {
        Self {
           errors: vec![ShaderError::IoErr(err)] 
        }
    }
}
impl From<ShaderError> for ShaderErrorList {
    fn from(err: ShaderError) -> Self {
        Self {
           errors: vec![err] 
        }
    }
}
impl ShaderErrorList {
    pub fn empty() -> Self {
        Self {
            errors: Vec::new()
        }
    }
    pub fn internal(error : String) -> Self {
        Self {
            errors: vec![ShaderError::InternalErr(error)]
        }
    }
    pub fn push(&mut self, error : ShaderError) {
        self.errors.push(error);
    }
}
