import * as vscode from "vscode";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";
import { MountPointDescriptor, StdioConsoleDescriptor, StdioFileDescriptor, StdioPipeInDescriptor, StdioPipeOutDescriptor, StdioTerminalDescriptor, VSCodeFileSystemDescriptor, Wasm, WasmProcess, WasmPseudoterminal } from "@vscode/wasm-wasi";

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

            function getTerminal(io: StdioFileDescriptor | StdioTerminalDescriptor| StdioPipeInDescriptor| StdioPipeOutDescriptor | StdioConsoleDescriptor | undefined): StdioFileDescriptor | StdioTerminalDescriptor | undefined
            { 
                if (io?.kind === "terminal") {   
                    return io as StdioTerminalDescriptor;
                } else if (io?.kind === "file") {   
                    return io as StdioFileDescriptor;
                } else {
                    throw new Error('Something bad happened');
                }
            }
            // Create a WASM process.
            this.process = await wasm.createProcess('shader-language-server', module, 
            { 
                // Flip stdin & stdout as process will write to stdout & we want to read to stdin
                stdio: pty.stdio,
               // stdio: { in: getTerminal(pty.stdio.out), out: getTerminal(pty.stdio.in), err: pty.stdio.err },
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
    onError(string: String)
    {
    }

    listen()
    {
        let self = this;
        function readLine() {
            self.pty?.readline().then((string : String)=> {
                self.onData(string);
                console.log("Received some data: ", string);
                readLine();
            });
        }
        readLine();
        // Should read std err aswell
    }

    write(message : string)
    {
        console.log("Sending some data: ", message);
        this.pty?.write(message);
    }

    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ) {
        if (document.uri.scheme === "file")
        {
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
