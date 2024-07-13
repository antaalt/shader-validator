import * as vscode from "vscode";
import * as cp from "child_process";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";

import { getBinaryPath, ValidationParams, Validator } from "./validator";
import path = require("path");

export class ValidatorChildProcess implements Validator {
    server: cp.ChildProcessWithoutNullStreams | null;
    callbacks: { [key: number]: (data: RPCResponse<any> | null) => void };
    currId: number = 1;

    constructor()
    { 
        this.server = null;
        this.callbacks = {};
    }
    dispose()
    {
        this.server?.kill();
    }
    async launch(context: vscode.ExtensionContext)
    {
        const executable = getBinaryPath(context, 'shader_language_server.exe');
        this.server = cp.spawn(executable.fsPath);
        this.server.stdin.setDefaultEncoding("utf8");
        this.server.stdout.setEncoding("utf8");
        this.server.stderr.setEncoding("utf8");

        this.listen();
    }

    onData(string: String)
    {
        console.log("Received some data: ", string);
        const messages = string.split("\n").filter((msg) => msg.length !== 0);
        
        messages.forEach((message) => 
        {
            try
            {
                let json: RPCResponse<any> = JSON.parse(message);
                if (json && json.jsonrpc === "2.0" && typeof json.id === "number")
                {
                    let cb = this.callbacks[json.id];
                    if (cb) 
                    {
                        if ((json as any).error)
                        {
                            vscode.window.showErrorMessage(
                                `${JSON.stringify(json, null, "\t")}`
                            );
                            cb(null);
                        }
                        else 
                        {
                            cb(json);
                        }
                        delete this.callbacks[json.id];
                    }
                }
            }
            catch(e)
            {
                console.error(e, string, message);
            }
        });
    }
    onError(string: String)
    {
        console.error("Received some errors: ", string);
    }

    listen()
    {
        this.server?.stdout.on("data", (data: string) => {
            this.onData(data);
        });
        this.server?.stderr.on("data", (data: string) => {
            this.onError(data);
        });
    }

    write(message : string)
    {
        console.log("Sending some data: ", message);
        let res = this.server?.stdin.write(message);
        if (!res)
        {
            console.error("Failed to create server");
            console.log(this.server);
        }
    }

    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params: ValidationParams,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ) {
        if (document.uri.scheme === "file")
        {
            this.callbacks[this.currId] = cb;

            const req: RPCGetFileTreeRequest = {
                jsonrpc: "2.0",
                method: "get_file_tree",
                params: {
                    path: document.uri.fsPath,
                    cwd: path.dirname(document.uri.fsPath),
                    shadingLanguage: shadingLanguage,
                    includes: params.includes,
                    defines: params.defines,
                },
                id: this.currId,
            };

            this.write(JSON.stringify(req) + "\n");

            this.currId += 1;
        }
    }

    validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        temporaryFile: string | null,
        params: ValidationParams,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
        const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        // Check uri scheme to ensure file is saved.
        if (document.uri.scheme === "file" && workspace !== undefined)
        {
            this.callbacks[this.currId] = cb;

            const req: RPCValidateFileRequest = {
                jsonrpc: "2.0",
                method: "validate_file",
                params: {
                    path: temporaryFile || document.uri.fsPath,
                    cwd: path.dirname(document.uri.fsPath),
                    shadingLanguage: shadingLanguage,
                    includes: params.includes,
                    defines: params.defines,
                },
                id: this.currId,
            };

            this.write(JSON.stringify(req) + "\n");

            this.currId += 1;
        }
    }
}
