# hlsl

This is a simple extension allowing syntax highlighting & linting for various shader types. 

- HLSL (through dxc on desktop)
- GLSL (through glslang)
- WGSL (through naga)

## Features

### Syntax highlighting

This extension provide syntax highlighting for HLSL, GLSL & WGSL. It also provides some really basic auto completion.

### Linting

You cant lint your code in real time through this extension:
- WGSL uses Naga as backend for linting
- GLSL uses [glslang-rs](https://github.com/SnowflakePowered/glslang-rs) as backend. It provide complete linting for GLSL trough glslang API bindings from C.
- HLSL uses [hassle-rs](https://github.com/Traverse-Research/hassle-rs) as backend. It provides bindings to directx shader compiler in rust and though is linting HLSL efficiently.

## Extension Settings

This extension contributes the following settings:

* `hlsl.autocomplete`: Enable/disable autocomplete.
* `hlsl.validateOnType`: Enable/disable validate on type.
* `hlsl.validateOnSave`: Enable/disable this extension.
* `hlsl.severity`: Select log severity for linting.
* `hlsl.includes`: All includes for linting.

## Extension publishing

It relies on WASI extension support.
https://code.visualstudio.com/api/working-with-extensions/publishing-extension

```vsce package```

```code --install-extension myextension.vsix```
