import * as vscode from "vscode";
import * as cp from "child_process";

import {
    createStdioOptions,
    createUriConverters,
    startServer
} from './wasm-wasi-lsp'; // Should import from @vscode/wasm-wasi-lsp, but version not based on last released wasm-wasi version
import { MountPointDescriptor, ProcessOptions, Wasm } from "@vscode/wasm-wasi/v1";
import {
    CloseAction,
    CloseHandlerResult,
    DidChangeConfigurationNotification,
    ErrorAction,
    ErrorHandler,
    ErrorHandlerResult,
    LanguageClient,
    LanguageClientOptions,
    Message,
    Middleware,
    ProvideDocumentSymbolsSignature,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { sidebar } from "./extension";

export enum ServerPlatform {
    windows,
    linux,
    macOS,
    wasi,
}

export function isRunningOnWeb() : boolean {
    // Web environment is detected with no fallback on child process which is not supported there.
    return typeof cp.spawn !== 'function' || typeof process === 'undefined';
}

function getPlatformBinaryDirectoryPath(platform: ServerPlatform) : string {
    // CI is handling the copy to bin folder to avoid storage of exe on git.
    switch (platform) {
        case ServerPlatform.windows:
            return "bin/windows/";
        case ServerPlatform.linux:
            return "bin/linux/";
        case ServerPlatform.macOS:
            return "bin/macos/";
        case ServerPlatform.wasi:
            return "bin/wasi/";
    }
}
function getPlatformBinaryName(platform: ServerPlatform) : string {
    switch (platform) {
        case ServerPlatform.windows:
            return "shader-language-server.exe";
        case ServerPlatform.linux:
            return "shader-language-server";
        case ServerPlatform.macOS:
            return "shader-language-server";
        case ServerPlatform.wasi:
            return "shader-language-server.wasm";
    }
}
function getPlatformBinaryDirectoryUri(context: vscode.ExtensionContext, platform: ServerPlatform) : vscode.Uri {
    // process is undefined on the wasi.
    if (platform !== ServerPlatform.wasi && context.extensionMode === vscode.ExtensionMode.Development) {
        console.info("Running extension in dev mode. Looking for environment variable SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH targetting server.");
        if (process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH !== undefined) {
            console.info(`SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH found: ${process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH}`);
            return vscode.Uri.file(process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH + '/');
        } else {
            console.warn('SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH environment variable not found. Trying to launch from bin folder');
            return vscode.Uri.joinPath(context.extensionUri, getPlatformBinaryDirectoryPath(platform));
        }
    } else { // Running in production or test mode
        return vscode.Uri.joinPath(context.extensionUri, getPlatformBinaryDirectoryPath(platform));
    }
}
// Relative path from extension directory
export function getPlatformBinaryPath(platform: ServerPlatform) : string {
    return getPlatformBinaryDirectoryPath(platform) + getPlatformBinaryName(platform);
}
// Absolute path as uri
export function getPlatformBinaryUri(context: vscode.ExtensionContext, platform: ServerPlatform) : vscode.Uri {
    return vscode.Uri.joinPath(getPlatformBinaryDirectoryUri(context, platform), getPlatformBinaryName(platform));
}

export function getServerPlatform() : ServerPlatform {
    if (isRunningOnWeb()) {
        return ServerPlatform.wasi;
    } else {
        switch (process.platform) {
            case "win32":
                return ServerPlatform.windows;
            case "linux":
                return ServerPlatform.linux;
            case "darwin":
                return ServerPlatform.wasi; // For now, use WASI as I cannot test on MAC.
                //return ServerPlatform.macOS;
            default:
                return ServerPlatform.wasi; // Not supported. Fallback to WASI.
        }
    }
}

function notifyConfigurationChange(context: vscode.ExtensionContext, client: LanguageClient) {
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

function getMiddleware() : Middleware {
    return {
        async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) {
            const result = await next(document, token);
            if (result) {
                // /!\ Type casting need to match server data sent. /!\ 
                let resultArray = result as vscode.SymbolInformation[];
                sidebar.onDocumentSymbols(document.uri, resultArray);
            }
            return result;
        },
    };
}

class ShaderErrorHandler implements ErrorHandler {

    private readonly restarts: number[];
    private readonly maxRestartCount: number = 5;

    constructor() {
        this.restarts = [];
    }

    public error(_error: Error, _message: Message, count: number): ErrorHandlerResult {
        if (count && count <= 3) {
            vscode.window.showErrorMessage("Server encountered an error in transport. Trying to continue...");
            return { action: ErrorAction.Continue };
        }
        vscode.window.showErrorMessage("Server encountered an error in transport. Shutting down.");
        return { action: ErrorAction.Shutdown };
    }

    public closed(): CloseHandlerResult {
        this.restarts.push(Date.now());
        if (this.restarts.length <= this.maxRestartCount) {
            vscode.window.showErrorMessage(`Server was unexpectedly closed ${this.restarts.length+1} times. Restarting...`);
            return { action: CloseAction.Restart };
        } else {
            const diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
            if (diff <= 3 * 60 * 1000) {
                // Log from error.
                return { action: CloseAction.DoNotRestart, message: `The shader language server crashed ${this.maxRestartCount+1} times in the last 3 minutes. The server will not be restarted. Set shader-validator.trace.server to verbose for more information.` };
            } else {
                vscode.window.showErrorMessage(`Server was unexpectedly closed ${this.restarts.length+1} again. Restarting...`);
                this.restarts.shift();
                return { action: CloseAction.Restart };
            }
        }
    }
}

export async function createLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient | null> {
    // Create validator
    // Web does not support child process, use wasi instead.
    let platform = getServerPlatform();
    if (platform === ServerPlatform.wasi) {
        return createLanguageClientWASI(context);
    } else {
        return createLanguageClientStandard(context, platform);
    }
}
async function createLanguageClientStandard(context: vscode.ExtensionContext, platform : ServerPlatform) : Promise<LanguageClient | null> {
    const executable = getPlatformBinaryUri(context, platform);
    const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
    const defaultEnv = {};
    const env = (trace === "verbose") ? {
        ...defaultEnv,
        "RUST_BACKTRACE": "1", // eslint-disable-line 
        "RUST_LOG": "shader_language_server=trace", // eslint-disable-line @typescript-eslint/naming-convention
    } : defaultEnv;
    const serverOptions: ServerOptions = {
        command: executable.fsPath, 
        transport: TransportKind.stdio,
        options: {
            cwd: getPlatformBinaryDirectoryUri(context, platform).fsPath,
            env: env
        }
    };
    const clientOptions: LanguageClientOptions = {
        // Register the server for shader documents
        documentSelector: [
            { scheme: 'file', language: 'hlsl' },
            { scheme: 'file', language: 'glsl' },
            { scheme: 'file', language: 'wgsl' },
        ],
        middleware: getMiddleware(),
        errorHandler: new ShaderErrorHandler()
    };

    let client = new LanguageClient(
        'shader-validator',
        'Shader language server',
        serverOptions,
        clientOptions,
        context.extensionMode === vscode.ExtensionMode.Development 
    );

    // Start the client. This will also launch the server
    await client.start();

    // Ensure configuration is sent
    notifyConfigurationChange(context, client);

    return client;
}
async function createLanguageClientWASI(context: vscode.ExtensionContext) : Promise<LanguageClient> {
    const channelName = 'Shader language Server WASI'; // For trace option, need same name
    const channel = vscode.window.createOutputChannel(channelName);
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
        const executable = getPlatformBinaryUri(context, ServerPlatform.wasi);
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
        middleware: getMiddleware(),
        errorHandler: new ShaderErrorHandler()
    };


    let client = new LanguageClient(
        'shader-validator',
        channelName,
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
    notifyConfigurationChange(context, client);

    return client;
}
