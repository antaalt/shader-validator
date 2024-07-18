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
        console.info("Running extension in dev mode. Looking for environment variable SHADER_LANGUAGE_SERVER_EXECUTABLE targetting server.");
        if (process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE !== undefined) {
            console.info("SHADER_LANGUAGE_SERVER_EXECUTABLE found.");
            return vscode.Uri.file(process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE);
        } else {
            // CI is handling the copy to bin folder to avoid storage of exe on git.
            console.warn(`SHADER_LANGUAGE_SERVER_EXECUTABLE environment variable not found. Trying to launch ./bin/${executable}.`);
            return vscode.Uri.joinPath(context.extensionUri, "bin/" + executable);
        }
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