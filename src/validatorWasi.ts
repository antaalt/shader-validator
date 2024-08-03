import * as vscode from "vscode";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";
import { MemoryFileSystem, MountPointDescriptor, Readable, Stdio, Wasm, WasmProcess, WasmPseudoterminal, Writable } from "@vscode/wasm-wasi/v1";
import path = require("path");
import { getBaseName, getBinaryPath, ValidationParams, Validator } from "./validator";

export class ValidatorWasi implements Validator {
    callbacks: { [key: number]: (data: RPCResponse<any> | null) => void };
    currId: number = 1;
    pty: WasmPseudoterminal | null;
    outProcess: Readable | null;
    inProcess: Writable | null;
    process: WasmProcess | null;
    fs: MemoryFileSystem | null;

    constructor()
    { 
        this.callbacks = {};
        this.pty = null;
        this.process = null;
        this.outProcess = null;
        this.inProcess = null;
        this.fs = null;
    }
    dispose()
    {
        this.process?.terminate();
    }
    async launch(context: vscode.ExtensionContext)
    {
        // Load the WASM API
        const wasm: Wasm = await Wasm.load();

        const pty = wasm.createPseudoterminal();
        this.outProcess = wasm.createReadable();
        this.inProcess = wasm.createWritable();
        const stdio : Stdio = {
            in:  {kind: "pipeIn", pipe: this.inProcess},
            out: {kind: "pipeOut", pipe: this.outProcess},
            err: {kind: "terminal", terminal: pty}
        };
        
        const terminal = vscode.window.createTerminal({
            name: 'Shader language server',
            pty,
            isTransient: true
        });
        // Only for debug.
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            terminal.show(true);
        }

        // Create a memory file system to create cached files.
        this.fs = await wasm.createMemoryFileSystem();
        // Create virtual file systems to access workspaces from wasi app
        const mountPoints: MountPointDescriptor[] = [
            { kind: 'workspaceFolder'}, // Workspaces
            { kind: 'memoryFileSystem', fileSystem: this.fs, mountPoint: '/memory' }
        ];
        try {
            // Load the WASM module. It is stored alongside the extension's JS code.
            // So we can use VS Code's file system API to load it. Makes it
            // independent of whether the code runs in the desktop or the web.
            // TODO: need to bundle the wasm within the extension
            const executable = getBinaryPath(context, 'shader_language_server.wasm');
            const bits = await vscode.workspace.fs.readFile(executable);
            const module = await WebAssembly.compile(bits);

            // Create a WASM process.
            this.process = await wasm.createProcess('shader-language-server', module, 
            {
                stdio: stdio,
                args:[],
                env:{},
                mountPoints: mountPoints,
            });
            // Run the process and wait for its result.
            // As we are running a server, run it async to not block vs code.
            this.process.run().then((result: any) => {
                if (result !== 0) {
                    vscode.window.showErrorMessage(`Process shader-language-server ended with error: ${result}`);
                } else {
                    vscode.window.showErrorMessage(`Process shader-language-server ended without error: ${result}`);
                }
            }, (error) => {
                vscode.window.showErrorMessage(`Failed to run shader-language-server with error: ${error}`);
            });
        } catch (error : any) {
            // Show an error message if something goes wrong.
            await vscode.window.showErrorMessage(error.message);
            return; // Do not launch server.
        }
        this.pty = pty;
        this.listen();
    }

    onData(string: String)
    {
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
    }

    listen()
    {
        this.outProcess?.onData((data : Uint8Array)=> {
            const string = new TextDecoder().decode(data);
            console.log("Received some data: ", string);
            this.onData(string);
        });
        // stderr is directly redirected to pty.
    }

    write(message : string)
    {
        console.log("Sending some data: ", message);
        this.inProcess?.write(message);
    }

    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params:ValidationParams,
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
        params:ValidationParams,
        useTemporary: boolean,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
        const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        if ((document.uri.scheme === "file" || document.uri.scheme === "vscode-test-web") && workspace !== undefined)
        {
            this.callbacks[this.currId] = cb;
            // Somehow wasi fs does not support \\ & vscode path API keep using them everywhere...
            // Root path is inconsistent aswell. On desktop, wasi-core uses /workspace-name, on web, it uses /workspaces/workspace-name...
            const relativePath = path.join(
                '/workspaces/',
                workspace.name, 
                path.relative(workspace?.uri.fsPath.replace(/\\/g, "/"), document.uri.fsPath.replace(/\\/g, "/"))
            ).replace(/\\/g, "/");
            
            const tmpRelativePath = path.join(
                '/memory/',
                getBaseName(document.fileName)
            ).replace(/\\/g, "/");
            if (useTemporary)
            {
                this.fs?.createFile(getBaseName(document.fileName), new TextEncoder().encode(document.getText()));
            }
            
            const req: RPCValidateFileRequest = {
                jsonrpc: "2.0",
                method: "validate_file",
                params: {
                    path: useTemporary ? tmpRelativePath : relativePath,
                    cwd: path.dirname(relativePath),
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
