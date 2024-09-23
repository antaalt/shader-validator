# Shader validator

[![gitHub issues](https://img.shields.io/github/issues/antaalt/shader-validator.svg)](https://github.com/antaalt/shader-validator/issues)
[![vsmarketplace](https://img.shields.io/visual-studio-marketplace/v/antaalt.shader-validator?color=blue&label=vscode%20marketplace)](https://marketplace.visualstudio.com/items?itemName=antaalt.shader-validator)
[![ppenVSX registry](https://img.shields.io/open-vsx/v/antaalt/shader-validator?color=purple)](https://open-vsx.org/extension/antaalt/shader-validator)

This is a vscode extension allowing syntax highlighting, linting & symbol providing for HLSL / GLSL / WGSL shaders. It is using [shader-language-server](https://github.com/antaalt/shader-language-server) to lint shaders using common validator API & parse symbols for some code inspection.

Currently, it support some features and languages:

- Syntax Highlighting: Provide improved syntax highlighting for code.
- Diagnostic: Provide errors & warning as user type code.
- Symbol provider: provide goto, completion, hover & signature.
    - Local symbols: Provide all user created symbols (function, constant, types...).
    - Intrinsics symbols: Provide all languages provided intrinsics symbols.

|Language|Syntax Highlighting|Diagnostics|Local symbols|Intrinsics symbols|
|--------|-------------------|-----------|-------------|------------------|
|GLSL    |✅                 |✅        |✅           |✅               |
|HLSL    |✅                 |✅        |✅           |🚧               |
|WGSL    |✅                 |✅        |❌           |❌               |

## Features

### Syntax highlighting

This extension provide improved syntax highlighting for HLSL, GLSL & WGSL than the base one in VS code.

### Linting

You cant lint your code in real time through this extension:
- GLSL relies on Glslang.
- HLSL relies on DirectX shader compiler on desktop, Glslang on the web (see below).
- WGSL relies on Naga.

### Autocompletion

The extension will suggest you symbols from your file and intrinsics as you type.

### Signature

View available signatures for your function as you type it.

### Hover

View informations relative to a symbol by hovering it.

### Goto

Go to your declaration definition by clicking on it.

## Extension Settings

This extension contributes the following settings:

* `shader-validator.validateOnType`: Enable/disable validate on type.
* `shader-validator.validateOnSave`: Enable/disable validate on save.
* `shader-validator.severity`: Select minimal log severity for linting.
* `shader-validator.includes`: All custom includes for linting.
* `shader-validator.defines`: All custom macros and their values for linting.

HLSL specific settings: 
* `shader-validator.hlsl.shaderModel`: Specify the shader model to target for HLSL

GLSL specific settings:
* `shader-validator.glsl.targetClient`: Specify the OpenGL or Vulkan version for GLSL
* `shader-validator.glsl.spirvVersion`: Specify the SPIRV version to target for GLSL

## Platform support

This extension is supported on every platform, but some limitations are to be expected on some:
- Windows: full feature set.
- Mac & Linux: Rely on WASI version of server, same as web, see web support for limitations.

## Web support

This extension run on the web on [vscode.dev](https://vscode.dev/). It is relying on the [WebAssembly Execution engine](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core). Because of this restriction, we can't use dxc on the web as it does not compile to WASI and instead rely on glslang, which is more limited in linting (Only support some basic features of SM 6.0, while DXC support all newly added SM (current 6.8)).

## Credits

This extension is based on a heavily modified version of PolyMeilex [vscode-wgsl](https://github.com/PolyMeilex/vscode-wgsl)