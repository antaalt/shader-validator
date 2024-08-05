import * as vscode from "vscode";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";
import {
    createStdioOptions,
    createUriConverters,
    startServer
} from '@vscode/wasm-wasi-lsp';
import { MemoryFileSystem, MountPointDescriptor, ProcessOptions, Readable, Stdio, Wasm, WasmProcess, WasmPseudoterminal, Writable } from "@vscode/wasm-wasi";
import path = require("path");
import { getBaseName, getBinaryPath, ValidationParams, Validator } from "./validator";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";

export class ValidatorWasi implements Validator {
    process: WasmProcess | null;
    client: LanguageClient | null;

    constructor()
    { 
        this.process = null;
        this.client = null;
    }
    dispose()
    {
        
        if (this.client)
        {
            this.client.stop().then(_ => {}, e => {
                console.error(e);
            });

            this.process?.terminate().then(_ => {}, e => {
                console.error(e);
            });
        }
    }
    async launch(context: vscode.ExtensionContext)
    {
        const channel = vscode.window.createOutputChannel('shader-language-server-wasi');

        const serverOptions: ServerOptions = async () => {
            // Load the WASM API
            const wasm: Wasm = await Wasm.load();
            // Create virtual file systems to access workspaces from wasi app
            const mountPoints: MountPointDescriptor[] = [
                { kind: 'workspaceFolder'}, // Workspaces
            ];
            // Load the WASM module. It is stored alongside the extension's JS code.
            // So we can use VS Code's file system API to load it. Makes it
            // independent of whether the code runs in the desktop or the web.
            // TODO: need to bundle the wasm within the extension
            const executable = getBinaryPath(context, 'shader_language_server.wasm');
            const bits = await vscode.workspace.fs.readFile(executable);
            const module = await WebAssembly.compile(bits);

            const options : ProcessOptions = {
                stdio: createStdioOptions(),
                env:{},
                mountPoints: mountPoints
            };
            // Memory options required by wasm32-wasip1-threads target
            const memory : WebAssembly.MemoryDescriptor = {
                initial: 160, 
                maximum: 160, 
                shared: true
            };

            // Create a WASM process.
            this.process = await wasm.createProcess('shader-language-server', module, memory, options);
            
            // Hook stderr to the output channel
            const decoder = new TextDecoder('utf-8');
            this.process.stderr!.onData(data => {
                channel.append(decoder.decode(data));
            });
            this.process.stdout!.onData(data => {
                channel.append(decoder.decode(data));
            });
            return startServer(this.process);
        };

        // Now we start client
        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ language: 'plaintext' }],
            outputChannel: channel,
            uriConverters: createUriConverters()
        };


        this.client = new LanguageClient(
            'shader-language-server',
            'Shader language server WASI',
            serverOptions,
            clientOptions
        );
        await this.client.start();
    }

    onData(string: String)
    {
    }
    onError(string: String)
    {
    }

    listen()
    {
    }

    write(message : string)
    {
    }

    getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params:ValidationParams,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ) {
    }

    validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params:ValidationParams,
        useTemporary: boolean,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
    }
}
