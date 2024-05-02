import * as vscode from "vscode";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";
import { MountPointDescriptor, VSCodeFileSystemDescriptor, Wasm, WasmProcess, WasmPseudoterminal } from "@vscode/wasm-wasi";

export class Validator {
    callbacks: { [key: number]: (data: RPCResponse<any> | null) => void };
    currId: number = 1;
    pty: WasmPseudoterminal | null;
    process: WasmProcess | null;

    constructor()
    { 
        this.callbacks = {};
        this.pty = null;
        this.process = null;
    }
    dispose()
    {
        this.process?.terminate();
    }
    async launch(context: vscode.ExtensionContext)
    {
        // Load the WASM API
        const wasm: Wasm = await Wasm.api();

        const pty = wasm.createPseudoterminal();
        const terminal = vscode.window.createTerminal({
            name: 'Shader language server',
            pty,
            isTransient: true
        });
        // Only for debug.
        terminal.show(true);
        // Create virtual file systems to access workspaces from wasi app
        let mountPoints : MountPointDescriptor[] = [];
        const testMountPoint : VSCodeFileSystemDescriptor = { kind: 'vscodeFileSystem', uri: vscode.Uri.joinPath(context.extensionUri, "test"), mountPoint:"/test"};
        mountPoints.push(testMountPoint);
        vscode.workspace.workspaceFolders?.forEach((element) => {
            const workspaceMountPoint : VSCodeFileSystemDescriptor = { kind: 'vscodeFileSystem', uri: element.uri, mountPoint:"/test"};
            mountPoints.push(workspaceMountPoint);
        });
        try {
            // Load the WASM module. It is stored alongside the extension's JS code.
            // So we can use VS Code's file system API to load it. Makes it
            // independent of whether the code runs in the desktop or the web.
            //const extensionLocalPath = 'shader-language-server/pkg/shader_language_server.wasm';
            const extensionLocalPath = 'shader-language-server/target/wasm32-wasi/debug/shader_language_server.wasm';
            const bits = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, extensionLocalPath));
            const module = await WebAssembly.compile(bits);
            // Create a WASM process.
            this.process = await wasm.createProcess('shader-language-server', module, 
            { 
                stdio: pty.stdio,
                args:[],
                env:{},
                mountPoints: mountPoints,
            });
            // Run the process and wait for its result.
            // As we are running a server, run it async to not block vs code.
            this.process.run().then(async (result) => {
                if (result !== 0)
                {
                    await vscode.window.showErrorMessage(`Process shader-language-server ended with error: ${result}`);
                }
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

    listen()
    {
        if (this.pty?.stdio.out?.kind === 'pipeOut') 
        {
            this.pty.stdio.out.pipe?.onData((data: Uint8Array) => {
                const string = new TextDecoder().decode(data);
                this.onData(string);
            });
        }
        else if (this.pty?.stdio.out?.kind === 'terminal') 
        {
            console.log("Received some data ");
            let self = this;
            function readLine() {
                if (self.pty?.stdio.out?.kind === 'terminal') 
                {
                    self.pty.stdio.out.terminal.readline().then((string : String) => {
                        self.onData(string);
                        console.log("Received some data: ", string);
                        readLine();
                    });
                }
            }
            readLine();
        }

        if (this.pty?.stdio.err?.kind === 'pipeOut') 
        {
            this.pty.stdio.err.pipe?.onData((data: Uint8Array) => {
                const errorMessage = new TextDecoder().decode(data);
                console.log(errorMessage);
            });
        }
        else if (this.pty?.stdio.out?.kind === 'terminal') 
        {
            
        }
    }

    write(message : string)
    {
        if (this.pty?.stdio.in?.kind === 'pipeIn') 
        {
            this.pty.stdio.in.pipe?.write(message, "utf-8");
        }
        else if (this.pty?.stdio.in?.kind === 'terminal')
        {
            this.pty.stdio.in.terminal.write(message);
        }
    }

    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ) {
        if (document.uri.scheme === "file") {
            this.callbacks[this.currId] = cb;

            console.log(document.uri.fsPath);

            const req: RPCGetFileTreeRequest = {
            jsonrpc: "2.0",
            method: "get_file_tree",
            params: {
                path: document.uri.fsPath,
                shadingLanguage: shadingLanguage
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
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
        if (document.uri.scheme === "file") {
            this.callbacks[this.currId] = cb;
            const req: RPCValidateFileRequest = {
                jsonrpc: "2.0",
                method: "validate_file",
                params: {
                    path: document.uri.fsPath,
                    shadingLanguage: shadingLanguage
                },
                id: this.currId,
            };

            this.write(JSON.stringify(req) + "\n");

            this.currId += 1;
        }
    }
}
