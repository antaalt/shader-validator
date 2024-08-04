import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCUnknownError,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";


import {
    LanguageClient,
    LanguageClientOptions,
    ProtocolNotificationType0,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

import { getBaseName, getBinaryPath, ValidationParams, Validator } from "./validator";
import path from "path";
import os from "os";

export function getTemporaryFolder() {
    let tmpDir = os.tmpdir();
    return `${tmpDir}${path.sep}shaders-validator${path.sep}`;
}

export class ValidatorChildProcess implements Validator {
    callbacks: { [key: number]: (data: RPCResponse<any> | null) => void };
    currId: number = 1;
    client: LanguageClient | null;

    constructor()
    { 
        //this.server = null;
        this.callbacks = {};
        this.client = null;
        // Create temporary folder
        fs.mkdir(getTemporaryFolder(), { recursive: true }, e => console.assert(e === null, e));
        
    }
    dispose()
    {
        // Remove temporary files created during extension usage.
        fs.rm(getTemporaryFolder(), { recursive: true, force: true }, e => console.assert(e === null, e));
        //this.server?.kill();
        
        if (!this.client) {
            return undefined;
        }
        return this.client.stop();
    }
    async launch(context: vscode.ExtensionContext)
    {
        const executable = getBinaryPath(context, 'shader_language_server.exe');
        let debugOptions = { execArgv: [] };
        let serverOptions: ServerOptions = {
            command: executable.fsPath, 
            transport: TransportKind.stdio,
            options: {
                //detached: true,
                shell: true,
            }
        };
        let clientOptions: LanguageClientOptions = {
            // Register the server for plain text documents
            documentSelector: [
                { scheme: 'file', language: 'hlsl' },
                { scheme: 'file', language: 'glsl' },
                { scheme: 'file', language: 'wgsl' },
            ],
            synchronize: {
                // Notify the server about file changes to files contained in the workspace
                fileEvents: [
                    vscode.workspace.createFileSystemWatcher('**/.hlsl'),
                    vscode.workspace.createFileSystemWatcher('**/.glsl'),
                    vscode.workspace.createFileSystemWatcher('**/.wgsl'),
                ]
            }
        };

        this.client = new LanguageClient(
            'shader-language-server',
            'Shader language Server',
            serverOptions,
            clientOptions
        );
        this.client.onNotification("validate_file", (notification: string) => {
            console.log (notification);
        });

        context.subscriptions.push(
            // Handle the "custom-stuff/add" request on the client.
            this.client.onRequest('custom-stuff/add', (args: { a: number; b: number }) => {
              return args.a + args.b;
            }),
          
            // The handler can be async.
            /*this.client.onRequest('custom-stuff/add-to-magic-number', async (args: number) => {
              return args + (await getMagicNumber());
            }),*/
          );

        // Start the client. This will also launch the server
        await this.client.start();
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
        /*this.server?.stdout.on("data", (data: string) => {
            this.onData(data);
        });
        this.server?.stderr.on("data", (data: string) => {
            this.onError(data);
        });*/
    }

    async write(message : string)
    {
        // Output: Focus on Output View
        console.log("Sending some data: ", message);
        const response = await this.client?.sendRequest('validate_file', message).then(edit => {
            console.log("RES:", edit);
            //return vscode.workspace.applyEdit(edit);
        }, err => {
           console.error('I am error');
        });
        console.log("RESPONSE", response);
        /*let res = this.server?.stdin.write(message);
        if (!res)
        {
            console.error("Failed to create server");
            console.log(this.server);
        }*/
    }

    async getFileTree(
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

            await this.write(JSON.stringify(req.params) + "\n");

            this.currId += 1;
        }
    }

    async validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params: ValidationParams,
        useTemporary: boolean,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
        const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        // Check uri scheme to ensure file is saved.
        if (document.uri.scheme === "file" && workspace !== undefined)
        {
            this.callbacks[this.currId] = cb;

            // Create temporary file if required
            let tempDir = getTemporaryFolder();
            let tmpPath = tempDir + getBaseName(document.fileName); // Keep same file
            if (useTemporary)
            {
                // Write content to temporary folder & pass path to linter.
                fs.writeFileSync(tmpPath, document.getText(), {
                    flag: "w"
                });
            }
            // https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
            // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
            const req: RPCValidateFileRequest = {
                jsonrpc: "2.0",
                method: "validate_file",
                params: {
                    path: useTemporary ? tmpPath : document.uri.fsPath,
                    cwd: path.dirname(document.uri.fsPath),
                    shadingLanguage: shadingLanguage,
                    includes: params.includes,
                    defines: params.defines,
                },
                id: this.currId,
            };

            const response = await this.client?.sendRequest('validate_file', req.params).then(edit => {
                console.log("RES:", edit);
                let result : RPCResponse<RPCValidationResponse> = {
                    id: 0,
                    result: edit as RPCValidationResponse,
                    jsonrpc: "jsonrpc2.0",
                };
                cb(result);
            }, err => {
                console.log("ERR:", err);
                let result : RPCResponse<RPCValidationResponse> = {
                    id: 0,
                    result: err as RPCValidationResponse,
                    jsonrpc: "jsonrpc2.0",
                };
                cb(result);
            });
            //await this.write(`Content-Length: ${request.length}\r\n\r\n${request}\\r\\n`);
            this.currId += 1;
        }
    }
}
