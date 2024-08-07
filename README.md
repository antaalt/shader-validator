# Shader validator


[![gitHub issues](https://img.shields.io/github/issues/antaalt/shader-validator.svg)](https://github.com/antaalt/shader-validator/issues)
[![vsmarketplace](https://img.shields.io/visual-studio-marketplace/v/antaalt.shader-validator?color=blue&label=vscode%20marketplace)](https://marketplace.visualstudio.com/items?itemName=antaalt.shader-validator)
[![ppenVSX registry](https://img.shields.io/open-vsx/v/antaalt/shader-validator?color=purple)](https://open-vsx.org/extension/antaalt/shader-validator)

This is a vscode extension allowing syntax highlighting & linting for various shader types. It is using [shader-language-server](https://github.com/antaalt/shader-language-server) to lint shaders using common validator API. Currently, it support:

- HLSL (through dxc on desktop, glslang on the web)
- GLSL (through glslang)
- WGSL (through naga)

## Features

### Syntax highlighting

This extension provide syntax highlighting for HLSL, GLSL & WGSL. It also provides some really basic auto completion.

### Linting

You cant lint your code in real time through this extension:
- WGSL uses [Naga](https://github.com/gfx-rs/naga) as backend for linting
- GLSL uses [glslang-rs](https://github.com/SnowflakePowered/glslang-rs) as backend. It provide complete linting for GLSL trough glslang API bindings from C.
- HLSL uses [hassle-rs](https://github.com/Traverse-Research/hassle-rs) as backend. It provides bindings to directx shader compiler in rust.

### Autocompletion

For now, a really basic support for autocompletion is available that will be improved with time.

## Extension Settings

This extension contributes the following settings:

* `hlsl.autocomplete`: Enable/disable autocomplete.
* `hlsl.validateOnType`: Enable/disable validate on type.
* `hlsl.validateOnTypeDelay`: Delay in milliseconds before triggering validate on type.
* `hlsl.validateOnSave`: Enable/disable this extension.
* `hlsl.severity`: Select log severity for linting.
* `hlsl.includes`: All includes for linting.
* `hlsl.defines`: All macros and their values for linting.

## Web support

This extension run on the web on [vscode.dev](https://vscode.dev/). It is relying on the [WebAssembly Execution engine](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core) that is currently in pre-release. Because of this restriction, we can't use dxc on the web as it does not compile to WASI and instead rely on glslang, which is more limited in linting (Only support SM 5.0, same as FXC, while DXC support SM 6.0 and more).

## Credits

This extension is based on a heavily modified version of PolyMeilex [vscode-wgsl](https://github.com/PolyMeilex/vscode-wgsl)