import * as vscode from "vscode";
import * as os from 'os';
import * as Path from 'path';

import {
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidationResponse,
} from "./rpc";


export interface ValidationParams {
    includes: string[];
    defines: {[key: string]: string};
}

export function getTemporaryFolder() {
    let tmpDir = os.tmpdir();
    return `${tmpDir}${Path.sep}shaders-validator${Path.sep}`;
}

export function getBinaryPath(context : vscode.ExtensionContext, executable : string)
{
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        // Hardcoded path to avoid copying the file.
        // Should be handled cleaner.
        return vscode.Uri.file("D:/Bibliotheque/Dev/shader-language-server/target/debug/" + executable);
    } else { // Running in production or test mode
        return vscode.Uri.joinPath(context.extensionUri, "bin/" + executable);
    }
}

export interface Validator {

    dispose(): void;

    launch(context: vscode.ExtensionContext): void;
    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params: ValidationParams,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ): void;
    validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        temporaryFile: string | null,
        params: ValidationParams,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ): void;
}