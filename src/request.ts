import {
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
}
export interface CompileShaderRegistrationOptions extends TextDocumentRegistrationOptions {}

export interface CompileShaderResult {
    compilationType: CompilationType,
    // Server sends a Vec<u8>, which serde serializes as a base64 string.
    data: string,
}

export function getCompiledShaderExtension(value: CompileShaderResult) : string {
    switch(value.compilationType) {
        case CompilationType.Spirv: return '.spirv';
        case CompilationType.Dxil: return '.dxil';
        case CompilationType.Wgsl: return '.wgsl';
        default: return '.bin';
    } 
}

/// Decode the base64 payload of a compilation result into raw bytes.
/// Cannot rely on Buffer here: it does not exist in the web extension host, and webpack
/// does not polyfill it for the webworker target.
export function decodeCompileShaderData(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export const compileShaderRequest = new ProtocolRequestType<CompileShaderParams, CompileShaderResult | null, never, void, CompileShaderRegistrationOptions>('textDocument/compilationResult');

// Request to dump ast to log.
export interface DumpAstParams extends TextDocumentIdentifier {}
export interface DumpAstRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpAstRequest = new ProtocolRequestType<DumpAstParams, string | null, never, void, DumpAstRegistrationOptions>('debug/dumpAst');


// Request to dump ast to log.
export interface DumpDependencyParams extends TextDocumentIdentifier {}
export interface DumpDependencyRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpDependencyRequest = new ProtocolRequestType<DumpDependencyParams, string | null, never, void, DumpDependencyRegistrationOptions>('debug/dumpDependency');