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