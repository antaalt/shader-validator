import {
    ProtocolRequestType,
    TextDocumentIdentifier, 
    TextDocumentRegistrationOptions,
} from "vscode-languageclient";

// Request to compile the shader
export interface CompileShaderParams extends TextDocumentIdentifier {}
export interface CompileShaderRegistrationOptions extends TextDocumentRegistrationOptions {}

export interface CompileShaderResult {
    ty: 'Dxil' | 'Spirv' | 'None',
    // Server sends a Vec<u8>, which serde serializes as a base64 string.
    data: string,
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