import * as vscode from "vscode";
import * as cp from "child_process";
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    createStdioOptions,
    createUriConverters,
    startServer
} from './wasm-wasi-lsp'; // Should import from @vscode/wasm-wasi-lsp, but version not based on last released wasm-wasi version
import { MountPointDescriptor, ProcessOptions, Wasm } from "@vscode/wasm-wasi/v1";
import {
    CloseAction,
    CloseHandlerResult,
    ConfigurationParams,
    ConfigurationRequest,
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
    wasi,
}

export function isRunningOnWeb() : boolean {
    // Web environment is detected with no fallback on child process which is not supported there.
    return typeof cp.spawn !== 'function' || typeof process === 'undefined';
}
function getServerVersion(serverPath: string, platform: ServerPlatform) : string | null {
    if (isRunningOnWeb() || platform === ServerPlatform.wasi) {
        // Bundled version always used on the web as we cant access external folders.
        // For wasi, we need some runner to test version & we cant do this here. So ignore check.
        return "shader-language-server v" + vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
    } else {
        if (fs.existsSync(serverPath)) {
            const result = cp.execSync(serverPath + " --version");
            const version = result.toString("utf8").trim();
            return version;
        } else {
            return null;
        }
    }
}
function isValidVersion(serverVersion: string) {
    const requestedServerVersion = vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
    const versionExpected = "shader-language-server v" + requestedServerVersion;
    return serverVersion === versionExpected;
}
function getUserServerPath(platform: ServerPlatform) : string | null {
    if (isRunningOnWeb()) {
        return null;
    } else {
        // Check configuration.
        let serverPath = vscode.workspace.getConfiguration("shader-validator").get<string>("serverPath");
        if (serverPath && serverPath.length > 0) {
            let serverVersion = getServerVersion(serverPath, platform);
            if (serverVersion) {
                console.info(`shader-validator.serverPath found: ${serverPath}`);
                return serverPath;
            } else {
                console.warn("shader-validator.serverPath not found.");
            }
        }
        // Check environment variables
        if (process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH !== undefined) {
            let envPath = process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH;
            let serverVersion = getServerVersion(envPath, platform);
            if (serverVersion) {
                console.info(`SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH found: ${envPath}`);
                return envPath;
            } else {
                console.warn("SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH server path not found.");
            }
        }
        // Use bundled executables.
        console.info("No server path user settings found. Using bundled executable.");
        return null;
    }
}
function getPlatformBinaryDirectoryPath(extensionUri: vscode.Uri, platform: ServerPlatform) : vscode.Uri {
    let serverPath = getUserServerPath(platform);
    if (serverPath) {
        return vscode.Uri.file(path.dirname(serverPath));
    } else {
        // CI is handling the copy to bin folder to avoid storage of exe on git.
        switch (platform) {
        case ServerPlatform.windows:
            return vscode.Uri.joinPath(extensionUri, "bin/windows/");
        case ServerPlatform.linux:
            return vscode.Uri.joinPath(extensionUri, "bin/linux/");
        case ServerPlatform.wasi:
            return vscode.Uri.joinPath(extensionUri, "bin/wasi/");
        }
    }
}
function getPlatformBinaryName(platform: ServerPlatform) : string {
    let serverPath = getUserServerPath(platform);
    if (serverPath) {
        return path.basename(serverPath);
    } else {
        switch (platform) {
            case ServerPlatform.windows:
                return "shader-language-server.exe";
            case ServerPlatform.linux:
                return "shader-language-server";
            case ServerPlatform.wasi:
                return "shader-language-server.wasm";
        }
    }
}
// Absolute path as uri
export function getPlatformBinaryUri(extensionUri: vscode.Uri, platform: ServerPlatform) : vscode.Uri {
    return vscode.Uri.joinPath(getPlatformBinaryDirectoryPath(extensionUri, platform), getPlatformBinaryName(platform));
}

export function getServerPlatform() : ServerPlatform {
    if (isRunningOnWeb()) {
        return ServerPlatform.wasi;
    } else {
        // Dxc only built for linux x64 & windows x64. Fallback to WASI for every other situations.
        switch (process.platform) {
            case "win32":
                return (process.arch === 'x64') ? ServerPlatform.windows : ServerPlatform.wasi;
            case "linux":
                return (process.arch === 'x64') ? ServerPlatform.linux : ServerPlatform.wasi;
            default:
                return ServerPlatform.wasi;
        }
    }
}
export function resolveVSCodeVariables(content: string) : string {
    return content.replace(/\$\{(.*?)\}/g, (_match: string, variable: string) : string => {
        // Solve these https://code.visualstudio.com/docs/reference/variables-reference
        if (variable.startsWith("env:")) {
            const substitution = process.env[variable.slice(4)];
            if (typeof substitution === "string") {
                return substitution;
            }
        }
        if (variable === "userHome") {
            return os.homedir();
        }
        if (variable === "workspaceFolder") {
            if (vscode.workspace.workspaceFolders) {
                // Pick first workspace and ignores others.
                return vscode.workspace.workspaceFolders[0].uri.fsPath;
            }
        }
        // All others variable are relative to currently opened file and will be a pain to implement so ignoring them for now.
        return "";
    });
}

function getMiddleware() : Middleware {
    return {
        async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) {
            const result = await next(document, token);
            if (result) {
                // /!\ Type casting need to match server data sent. /!\ 
                let resultArray = result as vscode.DocumentSymbol[];
                sidebar.onDocumentSymbols(document.uri, resultArray);
            }
            return result;
        },
        workspace: {
            async configuration(params: ConfigurationParams, token: vscode.CancellationToken, next : ConfigurationRequest.HandlerSignature) {
                // Here we resolve vscode variables ourselves as there is no API for this.
                // see https://github.com/microsoft/vscode/issues/140056
                // Only solve them for includes as we are dealing with path.
                let result = await next(params, token);
                console.debug("initial configuration", result);
                let resultArray = result as any[];
                let config = resultArray[0];
                config["includes"] = config["includes"].map((include: string) => {
                    return resolveVSCodeVariables(include);
                });
                console.debug("resolved configuration", config);
                return [config];
            }
        }
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
function getConfigurationAsString(): string {
    let config = vscode.workspace.getConfiguration("shader-validator");
    const configObject : { [key: string]: any } = {};
    for (const [key, value] of Object.entries(config)) {
        configObject[key] = value;
    }
    return JSON.stringify(configObject);
}
async function createLanguageClientStandard(context: vscode.ExtensionContext, platform : ServerPlatform) : Promise<LanguageClient | null> {
    const channelName = 'Shader language Server'; // For trace option, need same name
    const channel = vscode.window.createOutputChannel(channelName);
    context.subscriptions.push(channel);
    
    const executable = getPlatformBinaryUri(context.extensionUri, platform);
    const version = getServerVersion(executable.fsPath, platform);
    if (!version) {
        vscode.window.showErrorMessage(`Server executable not found.`);
        return null;
    }
    if (!isValidVersion(version)) {
        vscode.window.showWarningMessage(`${version} is not compatible with this extension (Expecting shader-language-server v${vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version}). Server may crash or behave weirdly.`);
    }
    // Current working directory need to be set to executable for finding DLL.
    // But it would be better to have it pointing to workspace.
    const cwd = getPlatformBinaryDirectoryPath(context.extensionUri, platform);
    console.info(`Executing server ${executable} with working directory ${cwd}`);
    const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
    const defaultEnv = {};
    const env = (trace === "verbose") ? {
        ...defaultEnv,
        "RUST_BACKTRACE": "1", // eslint-disable-line 
        "RUST_LOG": "shader_language_server=trace,shader_sense=trace", // eslint-disable-line @typescript-eslint/naming-convention
    } : (trace === "messages") ? {
        ...defaultEnv,
        "RUST_BACKTRACE": "1", // eslint-disable-line 
        "RUST_LOG": "shader_language_server=info,shader_sense=info", // eslint-disable-line @typescript-eslint/naming-convention
    } : defaultEnv;
    const serverOptions: ServerOptions = {
        command: executable.fsPath, 
        transport: TransportKind.stdio,
        args: [
            "--config",
            getConfigurationAsString()
        ],
        options: {
            cwd: cwd.fsPath,
            env: env,
        }
    };
    const clientOptions: LanguageClientOptions = {
        // Register the server for shader documents
        documentSelector: [
            { scheme: 'file', language: 'hlsl' },
            { scheme: 'file', language: 'glsl' },
            { scheme: 'file', language: 'wgsl' },
        ],
        outputChannel: channel,
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
    await client.start();

    return client;
}
async function createLanguageClientWASI(context: vscode.ExtensionContext) : Promise<LanguageClient | null> {
    const channelName = 'Shader language Server WASI'; // For trace option, need same name
    const channel = vscode.window.createOutputChannel(channelName);
    context.subscriptions.push(channel);
    
    // Load the WASM API
    const wasm: Wasm = await Wasm.load();

    // Load the WASM module. It is stored alongside the extension's JS code.
    // So we can use VS Code's file system API to load it. Makes it
    // independent of whether the code runs in the desktop or the web.
    const executable = getPlatformBinaryUri(context.extensionUri, ServerPlatform.wasi);
    const version = getServerVersion(executable.fsPath, ServerPlatform.wasi);
    if (!version) {
        vscode.window.showErrorMessage(`WASI server not found.`);
        return null;
    }
    if (!isValidVersion(version)) {
        vscode.window.showWarningMessage(`${version} is not compatible with extension (Expecting shader-language-server v${vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version}). Server may crash or behave weirdly.`);
    }
    const serverOptions: ServerOptions = async () => {
        // Create virtual file systems to access workspaces from wasi app
        const mountPoints: MountPointDescriptor[] = [
            { kind: 'workspaceFolder'}, // Workspaces
        ];
        console.info(`Executing wasi server ${executable}`);
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
            "RUST_LOG": "shader-language-server=trace,shader_sense=trace", // eslint-disable-line @typescript-eslint/naming-convention
        } : (trace === "messages") ? {
            ...defaultEnv,
            "RUST_BACKTRACE": "1", // eslint-disable-line 
            "RUST_LOG": "shader_language_server=info,shader_sense=info", // eslint-disable-line @typescript-eslint/naming-convention
        } : defaultEnv;

        const options : ProcessOptions = {
            stdio: createStdioOptions(),
            env: env,
            args: [
                "--config",
                getConfigurationAsString()
            ],
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

    return client;
}
