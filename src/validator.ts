import * as vscode from "vscode";

import {
    createStdioOptions,
    createUriConverters,
    startServer
} from './wasm-wasi-lsp'; // Should import from @vscode/wasm-wasi-lsp, but version not based on last released wasm-wasi version
import { MountPointDescriptor, ProcessOptions, Wasm } from "@vscode/wasm-wasi/v1";
import {
    DidChangeConfigurationNotification,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

function getBinaryPath(context : vscode.ExtensionContext, executable : string)
{
    // process might be undefined on the web.
    if (typeof process !== 'undefined' && context.extensionMode === vscode.ExtensionMode.Development) {
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
async function requestConfiguration(context: vscode.ExtensionContext, client: LanguageClient) {
    // Send empty configuration to notify of change in config. 
    // Server should then request a configuration to client that vscode should understand and answer.
    await client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: "", // Required as server expect some empty params
    });
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event : vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration("shader-validator"))
            {
                await client.sendNotification(DidChangeConfigurationNotification.type, {
                    settings: "",
                });
            }
        })
    );
}
export async function createLanguageClientStandard(context: vscode.ExtensionContext) {
    const executable = getBinaryPath(context, 'shader-language-server.exe');
    const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
    const defaultEnv = {};
    const env = (trace === "verbose") ? {
        ...defaultEnv,
        "RUST_BACKTRACE": "1", // eslint-disable-line 
        "RUST_LOG": "shader-language-server=trace", // eslint-disable-line @typescript-eslint/naming-convention
    } : defaultEnv;
    const serverOptions: ServerOptions = {
        command: executable.fsPath, 
        transport: TransportKind.stdio,
        options: {
            env: env
        }
    };
    const clientOptions: LanguageClientOptions = {
        // Register the server for shader documents
        documentSelector: [
            { scheme: 'file', language: 'hlsl' },
            { scheme: 'file', language: 'glsl' },
            { scheme: 'file', language: 'wgsl' },
        ]
    };

    let client = new LanguageClient(
        'shader-validator',
        'Shrimp language server',
        serverOptions,
        clientOptions,
        context.extensionMode === vscode.ExtensionMode.Development 
    );

    // Start the client. This will also launch the server
    await client.start();

    // Ensure configuration is sent
    await requestConfiguration(context, client);

    return client;
}
export async function createLanguageClientWASI(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel('Shrimp language Server WASI');
    context.subscriptions.push(channel);
    
    // Load the WASM API
    const wasm: Wasm = await Wasm.load();

    const serverOptions: ServerOptions = async () => {
        // Create virtual file systems to access workspaces from wasi app
        const mountPoints: MountPointDescriptor[] = [
            { kind: 'workspaceFolder'}, // Workspaces
        ];
        // Load the WASM module. It is stored alongside the extension's JS code.
        // So we can use VS Code's file system API to load it. Makes it
        // independent of whether the code runs in the desktop or the web.
        // TODO: need to bundle the wasm within the extension
        const executable = getBinaryPath(context, 'shader-language-server.wasm');
        const bits = await vscode.workspace.fs.readFile(executable);
        const module = await WebAssembly.compile(bits);

        
        const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
        const defaultEnv = {
            // https://github.com/rust-lang/rust/issues/117440
            //"RUST_MIN_STACK": "65535", // eslint-disable-line @typescript-eslint/naming-convention
        };
        const env = (trace === "verbose") ? {
            ...defaultEnv,
            "RUST_BACKTRACE": "1", // eslint-disable-line 
            "RUST_LOG": "shader-language-server=trace", // eslint-disable-line @typescript-eslint/naming-convention
        } : defaultEnv;

        const options : ProcessOptions = {
            stdio: createStdioOptions(),
            env: env,
            mountPoints: mountPoints,
            trace: true,
        };
        // Memory options required by wasm32-wasip1-threads target
        const memory : WebAssembly.MemoryDescriptor = {
            initial: 160, 
            maximum: 1024, // Big enough to handle glslang heavy RAM usage.
            shared: true
        };

        // Create a WASM process.
        const wasmProcess = await wasm.createProcess('shader-validator', module, memory, options);
        
        // Hook stderr to the output channel
        const decoder = new TextDecoder('utf-8');
        wasmProcess.stderr!.onData(data => {
            const text = decoder.decode(data);
            console.log("Received error:", text);
            channel.appendLine("[shader-language-server::error]" + text);
        });
        wasmProcess.stdout!.onData(data => {
            const text = decoder.decode(data);
            console.log("Received data:", text);
            channel.appendLine("[shader-language-server::data]" + text);
        });
        return startServer(wasmProcess);
    };

    // Now we start client
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'hlsl' },
            { scheme: 'file', language: 'glsl' },
            { scheme: 'file', language: 'wgsl' },
        ],
        outputChannel: channel,
        uriConverters: createUriConverters(),
		traceOutputChannel: channel,
    };


    let client = new LanguageClient(
        'shader-validator',
        'Shrimp language server WASI',
        serverOptions,
        clientOptions,
        context.extensionMode === vscode.ExtensionMode.Development 
    );
    
    // Start the client. This will also launch the server
    try {
		await client.start();
	} catch (error) {
		client.error(`Start failed`, error, 'force');
	}

    // Ensure configuration is sent
    await requestConfiguration(context, client);

    return client;
}
