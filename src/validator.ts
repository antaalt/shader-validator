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
        console.info("Running extension in dev mode. Looking for environment variable SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH targetting server.");
        if (process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH !== undefined) {
            console.info(`SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH found: ${process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH}`);
            return vscode.Uri.file(process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH + '/' + executable);
        } else {
            console.warn(`SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH environment variable not found. Trying to launch ./bin/${executable}.`);
            return vscode.Uri.joinPath(context.extensionUri, "bin/" + executable);
        }
    } else { // Running in production or test mode
        // CI is handling the copy to bin folder to avoid storage of exe on git.
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