import * as vscode from "vscode";

import {
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidationResponse,
} from "./rpc";

export interface Validator {

    dispose(): void;

    launch(context: vscode.ExtensionContext): void;
    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ): void;
    validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ): void;
}