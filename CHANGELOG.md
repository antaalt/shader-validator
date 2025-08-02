# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [unreleased]

### Added

- Support for `${workspaceFolder}` `${env:XXX}` `${userHome}` in configuration aswell as in variants. This let user pass workspace relative path in configuration.
- Setting `shader-validator.hlsl.spirv` for removing SPIRV warning.
- Changelog file.

### Changed

- Using [shader-language-server v0.8.0](https://github.com/antaalt/shader-sense/releases/tag/v0.8.0), which bring some interesting improvements such as structure completion, improvements on DXC validation aswell as various fixes & improvements. See more on release page.

## [0.6.5] - 2025-07-22

### Changed

- Using [shader-language-server v0.7.0](https://github.com/antaalt/shader-sense/releases/tag/v0.7.0) with performances improvements and bug fixes.


## [0.6.4] - 2025-06-09

### Fixed
- Fix an issue preventing the server to start on desktop wasi platform (macos, arm & other non-dxc compatible platforms)

## [0.6.3] - 2025-06-06

### Fixed
- Fix error on web version of vscode because of a call to fs.existsSync.

## [0.6.2] - 2025-06-06

### Added

- Improved error message
- Check server version

### Changed

- Using [shader-language-server v0.6.2](https://github.com/antaalt/shader-sense/releases/tag/v0.6.2) with small improvements and bug fixes.

### Fixed

- Fixed README missing `shader-validator.serverPath` setting

## [0.6.1] - 2025-05-12

### Added

- Setting `shader-validator.serverPath` for using a customly built server.

### Changed

- Using [shader-language-server v0.6.1](https://github.com/antaalt/shader-sense/releases/tag/v0.6.1) which should fix the server on unsupported architecture (such as ARM) by relying on the WASI version instead.


## [0.6.0] - 2025-05-03

### Fixed

- Some fixes & improvement to HLSL syntax highlighting.
- Improved logging for profiling.
- Custom error handler.
- Fixed variant serialisation not saving last checkbox tick
- When file not open, do not fail to find a variant, open it and defer the goto instead.
- Fix an error when opening a variant with first line empty triggering an error.

### Changed

- Using [shader-language-server v0.6.0](https://github.com/antaalt/shader-sense/releases/tag/v0.6.0) which bring improvements to the shader variant system.

## [0.5.5] - 2025-04-04

### Changed

- Using [shader-language-server v0.5.5](https://github.com/antaalt/shader-sense/releases/tag/v0.5.5) which bring inlay hint & constructor completion aswell as some small improvements.

## [0.5.4] - 2025-03-26

### Changed

- Using [shader-language-server v0.5.4](https://github.com/antaalt/shader-sense/releases/tag/v0.5.4) which hid symbol diagnostic behind a setting `shader-validator.symbolDiagnostics`

## [0.5.3] - 2025-03-23

### Changed

- Using [shader-language-server v0.5.3](https://github.com/antaalt/shader-sense/releases/tag/v0.5.3) with various fixes for performances and bug fixes.

## [0.5.2] - 2025-03-09

### Changed

- Using [shader-language-server v0.5.2](https://github.com/antaalt/shader-sense/releases/tag/v0.5.2) with various fixes for UTF8 encoding.

## [0.5.1] - 2025-03-04

### Changed

- Using [shader-language-server v0.5.1](https://github.com/antaalt/shader-sense/releases/tag/v0.5.1) with GLSL improvements & fixes to be on par with HLSL.

## [0.5.0] - 2025-03-01

### Fixed

- HLSL syntax highlighting improved
- Variant window, which let you add custom entry point to your shaders.

### Changed

- Using [shader-language-server v0.5.0](https://github.com/antaalt/shader-sense/releases/tag/v0.5.0) which bring changes with inactive region detection, workspace symbols, document symbols, and more.

## [0.4.2] - 2025-01-03

### Changed

- Using [shader-language-server v0.4.2](https://github.com/antaalt/shader-sense/releases/tag/v0.4.2) which bring DXC on Linux and debug command. 

## [0.4.1] - 2024-12-20

### Changed

- Using [shader-language-server v0.4.1](https://github.com/antaalt/shader-sense/releases/tag/v0.4.1) which bring some fixes.

## [0.4.0] - 2024-11-23

### Added

- Icons for HLSL / GLSL / WGSL

### Fixed
- Fix command validateFile that crashed. Now simply display a useless message. 

### Changed

- Using [shader-language-server v0.4.0](https://github.com/antaalt/shader-sense/releases/tag/v0.4.0) which is now using tree-sitter for symbol querying, and will be way more stable.

## [0.3.0] - 2024-09-30

### Added
- Setting `shader-validator.hlsl.version` for HLSL version
- Setting `shader-validator.hlsl.enable16bitTypes` for 16 bit type support

### Changed

- Using [shader-language-server v0.3.0](https://github.com/antaalt/shader-sense/releases/tag/v0.3.0) which add HLSL improvements & improve user experience.

## [0.2.4] - 2024-09-23

### Added
- Setting `shader-validator.hlsl.shaderModel`
- Setting `shader-validator.glsl.targetClient`
- Setting `shader-validator.glsl.spirvVersion`

### Changed

- Using [shader-language-server v0.2.4](https://github.com/antaalt/shader-sense/releases/tag/v0.2.4) which add HLSL and GLSL parameters.

## [0.2.3] - 2024-09-22

### Changed

- Using [shader-language-server v0.2.3](https://github.com/antaalt/shader-sense/releases/tag/v0.2.3) which fix a hanging on web via the WASI .

## [0.2.2] - 2024-09-22

### Changed

- Using [shader-language-server v0.2.2](https://github.com/antaalt/shader-sense/releases/tag/v0.2.2) which fix a crash of relative path on WASI & some other fixes.

## [0.2.1] - 2024-09-21

### Changed

- Using [shader-language-server v0.2.1](https://github.com/antaalt/shader-sense/releases/tag/v0.2.1) which fix a crash because of relative path conversion.


## [0.2.0] - 2024-09-07

### Changed

- Using [shader-language-server v0.2.0](https://github.com/antaalt/shader-sense/releases/tag/v0.2.0) which add scope detection.


## [0.1.3] - 2024-08-28

### Fixed
- Fixed CI issue that package the wrong server version.
- Ensure correct server version is picked.

### Changed

- Using [shader-language-server v0.1.3](https://github.com/antaalt/shader-sense/releases/tag/v0.1.3) which is now correctly picked.


## [0.1.2] - 2024-08-27

### Changed

- Using [shader-language-server v0.1.2](https://github.com/antaalt/shader-sense/releases/tag/v0.1.2) which fixes a server crash due to relative include.


## [0.1.1] - 2024-08-26

### Changed

- Using [shader-language-server v0.1.1](https://github.com/antaalt/shader-sense/releases/tag/v0.1.1) which fixes a server crash on code completion.


## [0.1.0] - 2024-08-25

### Added

- Extension is now a LSP client.
- Autocompletion
- Signature helper
- Hover
- Go to definition

### Changed

- Using [shader-language-server v0.1.0](https://github.com/antaalt/shader-sense/releases/tag/v0.1.0) which is now based on the [LSP protocol](https://microsoft.github.io/language-server-protocol/) which allow this server to be used by any client following this protocol.


## [0.0.5] - 2024-08-03

### Fixed

- Fix the web version of the linter. Some issues prevented it to work correctly which are now fixed.

### Changed

- Using [shader-language-server v0.0.5](https://github.com/antaalt/shader-sense/releases/tag/v0.0.5) which is now based on the [LSP protocol](https://microsoft.github.io/language-server-protocol/) which allow this server to be used by any client following this protocol.

## [0.0.4] - 2024-07-29

### Changed

- Using [shader-language-server v0.0.4](https://github.com/antaalt/shader-sense/releases/tag/v0.0.4) which fixes some web issues.

## [0.0.3] - 2024-07-21

### Added

- Bundle the extension and make it runnable on the web. The web version is not working already as some dependencies are in pre-release.

## [0.0.2] - 2024-07-20

### Changed

- Using [shader-language-server v0.0.3](https://github.com/antaalt/shader-sense/releases/tag/v0.0.3) which bring fixes & improvements for GLSLang which now support includes & macros aswell as column errors.


## [0.0.1] - 2024-07-14

Initial release of this extension using [shader-language-server v0.0.1](https://github.com/antaalt/shader-sense/releases/tag/v0.0.1)


<!-- Below are link for above changelog titles-->
[unreleased]: https://github.com/antaalt/shader-validator/compare/v0.6.5...HEAD
[0.6.5]: https://github.com/antaalt/shader-validator/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/antaalt/shader-validator/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/antaalt/shader-validator/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/antaalt/shader-validator/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/antaalt/shader-validator/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/antaalt/shader-validator/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/antaalt/shader-validator/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/antaalt/shader-validator/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/antaalt/shader-validator/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/antaalt/shader-validator/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/antaalt/shader-validator/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/antaalt/shader-validator/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/antaalt/shader-validator/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/antaalt/shader-validator/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/antaalt/shader-validator/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/antaalt/shader-validator/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/antaalt/shader-validator/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/antaalt/shader-validator/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/antaalt/shader-validator/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/antaalt/shader-validator/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/antaalt/shader-validator/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/antaalt/shader-validator/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/antaalt/shader-validator/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/antaalt/shader-validator/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/antaalt/shader-validator/compare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/antaalt/shader-validator/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/antaalt/shader-validator/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/antaalt/shader-validator/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/antaalt/shader-validator/releases/tag/v0.0.1