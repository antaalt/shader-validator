# Shader validator

This is a vscode extension allowing syntax highlighting & linting for HLSL / GLSL / WGSL shaders. It is using [shader-language-server](https://github.com/antaalt/shader-language-server) to lint shaders using common validator API. 

Currently, it support some features and languages:

|Language|Syntax Highlighting|Diagnostics|Completion|Signature|Hover|Goto|
|--------|-------------------|-----------|----------|---------|-----|----|
|GLSL    |✅                 |✅        |✅        |✅      |✅   |✅ |
|HLSL    |✅                 |✅        |❌        |❌      |❌   |❌ |
|WGSL    |✅                 |✅        |❌        |❌      |❌   |❌ |

## Features

### Syntax highlighting

This extension provide syntax highlighting for HLSL, GLSL & WGSL. It also provides some really basic auto completion.

### Linting

You cant lint your code in real time through this extension:
- WGSL uses [Naga](https://github.com/gfx-rs/naga) as backend for linting
- GLSL uses [glslang-rs](https://github.com/SnowflakePowered/glslang-rs) as backend. It provide complete linting for GLSL trough glslang API bindings from C.
- HLSL uses [hassle-rs](https://github.com/Traverse-Research/hassle-rs) as backend. It provides bindings to directx shader compiler in rust.

### Autocompletion

The extension will suggest you symbols from your file as you type.

### Sigature

View available signatures for your function as you type it.

### Hover

View informations relative to an element by hovering it.

### Goto

Go to your declaration definition by clicking on it.

## Extension Settings

This extension contributes the following settings:

* `shader-validator.autocomplete`: Enable/disable completion suggestion.
* `shader-validator.validateOnType`: Enable/disable validate on type.
* `shader-validator.validateOnSave`: Enable/disable validate on save.
* `shader-validator.severity`: Select minimal log severity for linting.
* `shader-validator.includes`: All custom includes for linting.
* `shader-validator.defines`: All custom macros and their values for linting.

## Web support

This extension run on the web on [vscode.dev](https://vscode.dev/). It is relying on the [WebAssembly Execution engine](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core) that is currently in pre-release. Because of this restriction, we can't use dxc on the web as it does not compile to WASI and instead rely on glslang, which is more limited in linting (Only support SM 5.0, same as FXC, while DXC support SM 6.0 and more).

## Credits

This extension is based on a heavily modified version of PolyMeilex [vscode-wgsl](https://github.com/PolyMeilex/vscode-wgsl)