import {
    MessageDirection, 
    ProtocolRequestType,
    TextDocumentIdentifier, 
    TextDocumentRegistrationOptions,
    SignatureHelpRequest
} from "vscode-languageclient";

// Request to dump ast to log.
export interface DumpAstParams extends TextDocumentIdentifier {}
export interface DumpAstRegistrationOptions extends TextDocumentRegistrationOptions {}

export const dumpAstRequest = new ProtocolRequestType<DumpAstParams, string | null, never, void, DumpAstRegistrationOptions>('debug/dumpAst');
