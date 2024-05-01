# hlsl

This is a simple extension allowing some basic features for various shader types.
- HLSL (with linting through DXC)
- GLSL (with linting through glslangvalidator)
- WGSL (with linting through Naga)

## Why
Not much efficient & light HLSL linter / highlighter easy to maintain & up to date. Most of them are abandonned.  
- [Shader languages support for VS Code](https://github.com/stef-levesque/vscode-shader) does not offer shader linting but still cool providing features that works well. 
- [HLSL Tools](https://github.com/tgjones/HlslTools) it offer linting by rewriting a complete pseudo HLSL compiler for HLSL which make it really tedious to maintain & update with newer HLSL version.
- [HLSL linter](https://github.com/A2K/vscode-hlsl-linter) really basic linting but works with DXC which make it easy to update.
- [vscode-wgsl](https://github.com/PolyMeilex/vscode-wgsl) a nice API with a rust backend server to lint & provide functionnalities for wgsl only using Naga.


## Features



## Requirements

Might need to install DXC or Naga 

## Extension Settings

This extension contributes the following settings:

* `hlsl.autocomplete`: Enable/disable autocomplete.
* `hlsl.validateOnType`: Enable/disable validate on type.
* `hlsl.validateOnSave`: Enable/disable this extension.
* `hlsl.severity`: Select log severity for linting.
* `hlsl.includes`: All includes for linting.

## Extension publishing

https://code.visualstudio.com/api/working-with-extensions/publishing-extension

```vsce package```

```code --install-extension myextension.vsix```

## Interesting resources

https://code.visualstudio.com/blogs/2023/06/05/vscode-wasm-wasi

https://github.com/MattSutherlin/HLSL_ST3/blob/master/HLSL.sublime-syntax

https://www.osohq.com/post/building-vs-code-extension-with-rust-wasm-typescript

https://www.npmjs.com/package/@vscode/wasm-wasi

## File system
wasi file system is virtual for security reason, so need to map our virtual folder to wasi process.
