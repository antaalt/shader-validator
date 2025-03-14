import {
    ProtocolRequestType,
    TextDocumentIdentifier, 
    TextDocumentRegistrationOptions,
} from "vscode-languageclient";

// Request to dump ast to log.
export interface DumpAstParams extends TextDocumentIdentifier {}
export interface DumpAstRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpAstRequest = new ProtocolRequestType<DumpAstParams, string | null, never, void, DumpAstRegistrationOptions>('debug/dumpAst');


// Request to dump ast to log.
export interface DumpDependencyParams extends TextDocumentIdentifier {}
export interface DumpDependencyRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpDependencyRequest = new ProtocolRequestType<DumpDependencyParams, string | null, never, void, DumpDependencyRegistrationOptions>('debug/dumpDependency');