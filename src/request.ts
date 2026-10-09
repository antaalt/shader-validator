import {
    DocumentUri,
    ProtocolRequestType,
    TextDocumentIdentifier, 
    TextDocumentRegistrationOptions,
} from "vscode-languageclient";

export enum CompilationType {
    Dxil = 'Dxil',
    Spirv = 'Spirv',
    Wgsl = 'Wgsl',
}

// Request to compile the shader
export interface CompileShaderParams extends TextDocumentIdentifier {
    compilationType?: CompilationType,
    disassemble?: boolean,
}
export interface CompileShaderRegistrationOptions extends TextDocumentRegistrationOptions {}

export interface CompileShaderResult {
    compilationType: CompilationType,
    // Server sends a string that might be base64 encoded if result is binary. Check isCompilationResultBinary & isCompilationResultString
    data: string,
}

export function isCompilationResultBinary(compilationType: CompilationType, disassembly: boolean): boolean {
    // Disassembly is sent as raw string, same as wgsl. Spirv and Dxil are binary base64 encoded.
    return (compilationType == CompilationType.Spirv || compilationType == CompilationType.Dxil) && !disassembly;
}

export function isCompilationResultString(compilationType: CompilationType, disassembly: boolean): boolean {
    return !isCompilationResultBinary(compilationType, disassembly);
}

export function getCompiledShaderExtension(value: CompileShaderResult) : string {
    switch(value.compilationType) {
        case CompilationType.Spirv: return '.spirv';
        case CompilationType.Dxil: return '.dxil';
        case CompilationType.Wgsl: return '.wgsl';
        default: return '.bin';
    } 
}

export function getCompiledShaderLanguage(value: CompileShaderResult) : string {
    switch(value.compilationType) {
        case CompilationType.Spirv: return 'spirv';
        case CompilationType.Dxil: return 'dxil';
        case CompilationType.Wgsl: return 'wgsl';
        default: return 'plaintext';
    } 
}

/// Decode the base64 payload of a compilation result into raw bytes.
/// Cannot rely on Buffer here: it does not exist in the web extension host, and webpack
/// does not polyfill it for the webworker target.
export function decodeCompileShaderData(data: string, compilationType: CompilationType, disassemble: boolean): Uint8Array {
    const binary = isCompilationResultBinary(compilationType, disassemble) ? atob(data) : data;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export const compileShaderRequest = new ProtocolRequestType<CompileShaderParams, CompileShaderResult | null, never, void, CompileShaderRegistrationOptions>('textDocument/compilationResult');


// Request to get dependency tree of shader
export interface DependencyTreeParams extends TextDocumentIdentifier {}
export interface DependencyTreeRegistrationOptions extends TextDocumentRegistrationOptions {}

export interface DependencyTreeNode {
    uri: DocumentUri,
    includes: DependencyTreeNode[],
}

export const dependencyTreeRequest = new ProtocolRequestType<DependencyTreeParams, DependencyTreeNode, never, void, DependencyTreeRegistrationOptions>('textDocument/dependencyTree');

// Request to dump ast to log.
export interface DumpAstParams extends TextDocumentIdentifier {}
export interface DumpAstRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpAstRequest = new ProtocolRequestType<DumpAstParams, string | null, never, void, DumpAstRegistrationOptions>('debug/dumpAst');


// Request to dump ast to log.
export interface DumpDependencyParams extends TextDocumentIdentifier {}
export interface DumpDependencyRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpDependencyRequest = new ProtocolRequestType<DumpDependencyParams, string | null, never, void, DumpDependencyRegistrationOptions>('debug/dumpDependency');