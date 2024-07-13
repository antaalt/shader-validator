# Shader validator

This is a vscode extension allowing syntax highlighting & linting for various shader types. It is using [shader-language-server](https://github.com/antaalt/shader-language-server) to lint shaders using common validator API. Currently, it support:

- HLSL (through dxc on desktop)
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

## Extension Settings

This extension contributes the following settings:

* `hlsl.autocomplete`: Enable/disable autocomplete.
* `hlsl.validateOnType`: Enable/disable validate on type.
* `hlsl.validateOnTypeDelay`: Delay in milliseconds before triggering validate on type.
* `hlsl.validateOnSave`: Enable/disable this extension.
* `hlsl.severity`: Select log severity for linting.
* `hlsl.includes`: All includes for linting.
* `hlsl.defines`: All macros and their values for linting.
