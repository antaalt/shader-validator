# Shader validator

[![extension issues](https://img.shields.io/github/issues/antaalt/shader-validator.svg?label=extension%20issues)](https://github.com/antaalt/shader-validator/issues)
[![server issues](https://img.shields.io/github/issues/antaalt/shader-sense.svg?label=server%20issues)](https://github.com/antaalt/shader-sense/issues)
[![vsmarketplace](https://img.shields.io/visual-studio-marketplace/v/antaalt.shader-validator?color=blue&label=vscode%20marketplace)](https://marketplace.visualstudio.com/items?itemName=antaalt.shader-validator)
[![openVSX registry](https://img.shields.io/open-vsx/v/antaalt/shader-validator?color=purple)](https://open-vsx.org/extension/antaalt/shader-validator)

This is a vscode extension allowing syntax highlighting, linting & symbol providing for HLSL / GLSL / WGSL shaders. It is using [shader-language-server](https://github.com/antaalt/shader-sense/tree/main/shader-language-server) to lint shaders using common validator API & parse symbols for some code inspection.

Currently, it support some features and languages:

-   **[Syntax Highlighting](#syntax-highlighting)**: Improved syntax highlighting for code.
-   **[Diagnostic](#diagnostics)**: Highlight errors & warning as user type code.
-   **[goto](#goto)**: Go to a symbol definition
-   **[completion](#autocompletion)**: Suggest completion items
-   **[hover](#hover)**: Add tooltip when hovering symbols
-   **[signature](#signature)**: Help when selecting a signature
-   **[inlay hints](#inlay-hints)**: Add hints to function calls
-   **[Variant](#variants)**: Define multiple shader variant entry point & quickly switch between them. 
-   **[Regions](#regions)**: Detect inactive regions in code due to preprocessor and grey them out.

|Language|Syntax Highlighting|Diagnostics |User symbols |Built-in symbols|Regions|
|--------|-------------------|------------|-------------|----------------|-------|
|GLSL    |✅                 |✅(glslang)|✅           |✅             |✅     |
|HLSL    |✅                 |✅(DXC)    |✅           |✅             |✅     |
|WGSL    |✅                 |✅(Naga)   |❌           |❌             |❌     |

## Features

### Syntax highlighting

This extension provide improved syntax highlighting for HLSL, GLSL & WGSL than the base one in VS code.

![syntax-highlighting](res/doc/syntax-highlighting.png)

### Diagnostics

You cant lint your code in real time through this extension:

-   GLSL relies on Glslang.
-   HLSL relies on DirectX shader compiler on desktop, Glslang on the web (see below).
-   WGSL relies on Naga.

![diagnostic](res/doc/diagnostic.png)

### Autocompletion

The extension will suggest you symbols from your file and intrinsics as you type.

![diagnostic](res/doc/completion.png)

### Signature

View available signatures for your function as you type it.

![diagnostic](res/doc/signature.png)

### Hover

View informations relative to a symbol by hovering it.

![diagnostic](res/doc/hover.png)

### Goto

Go to your declaration definition by clicking on it.

![diagnostic](res/doc/goto.png)

### Inlay hints

Add inlay hints to your function calls. 

![inlay-hints](res/doc/inlay-hints.png)

You can disable this in settings.json (default pressed is Ctrl+Alt)
```json 
"editor.inlayHints.enabled": "on"
"editor.inlayHints.enabled": "onUnlessPressed"
"editor.inlayHints.enabled": "off"
"editor.inlayHints.enabled": "offUnlessPressed"
```

### Variants

Swap shader variant on the fly to change entry point & macro definition. This allow you to define and easily change between the one you have set, affecting regions. For example when you have a lot of entry point in a single shader file, splitted using macros, or want to see the content from your dependencies with the context passed from you main entry point.

You can then access these variants directly from the dedicated window and then access them by clicking on them.

A neat feature for big shader codebase with lot of entry point everywhere !

![shader-variant](res/doc/variants.png)

### Regions

Grey out inactive regions depending on currently declared preprocessor & filter symbols.

![diagnostic](res/doc/inactive-regions.png)

### And much more

This extension also support some features such as document symbols, workspace symbols...

## Extension Settings

This extension contributes the following settings:

*   `shader-validator.validate`: Enable/disable validation with common API.
*   `shader-validator.symbols`: Enable/disable symbol inspection & providers.
*   `shader-validator.symbolDiagnostics`: Enable/disable symbol provider debug diagnostics.
*   `shader-validator.severity`: Select minimal log severity for linting.
*   `shader-validator.includes`: All custom includes for linting.
*   `shader-validator.pathRemapping`: All virtual paths.
*   `shader-validator.defines`: All custom macros and their values for linting.
*   `shader-validator.serverPath`: Use a custom server instead of the bundled one.

### HLSL specific settings: 

*   `shader-validator.hlsl.shaderModel`: Specify the shader model to target for HLSL
*   `shader-validator.hlsl.version`: Specify the HLSL version
*   `shader-validator.hlsl.enable16bitTypes`: Enable 16 bit types support with HLSL

### GLSL specific settings:

*   `shader-validator.glsl.targetClient`: Specify the OpenGL or Vulkan version for GLSL
*   `shader-validator.glsl.spirvVersion`: Specify the SPIRV version to target for GLSL

## Platform support

This extension is supported on every platform, but some limitations are to be expected on some:
-   Windows: full feature set.
-   Linux: full feature set.
-   Mac: Rely on WASI version of server, same as web, see web support for limitations.

## Web support

This extension run on the web on [vscode.dev](https://vscode.dev/). It is relying on the [WebAssembly Execution engine](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core). Because of this restriction, we can't use dxc on the web as it does not compile to WASI and instead rely on glslang, which is more limited in linting (Only support some basic features of SM 6.0, while DXC support all newly added SM (current 6.8)).

## Credits

This extension is based on a heavily modified version of PolyMeilex [vscode-wgsl](https://github.com/PolyMeilex/vscode-wgsl)