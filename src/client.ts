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
    ProtocolNotificationType,
    ProvideDocumentSymbolsSignature,
    RequestType,
    ServerOptions,
    Trace,
    TransportKind
} from 'vscode-languageclient/node';
import { sidebar } from "./extension";

export enum ServerPlatform {
    windows,
    linux,
    wasi,
}

export enum ServerStatus {
    running,
    stopped,
    error,
}

export function isRunningOnWeb() : boolean {
    // Web environment is detected with no fallback on child process which is not supported there.
    return typeof cp.spawn !== 'function' || typeof process === 'undefined';
}

function getConfigurationAsString(): string {
    let config = vscode.workspace.getConfiguration("shader-validator");
    const configObject : { [key: string]: any } = {};
    for (const [key, value] of Object.entries(config)) {
        configObject[key] = value;
    }
    return JSON.stringify(configObject);
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
function getChannelName(): string {
    return 'Shader language Server';
}

export class ServerVersion {
    path: vscode.Uri;
    cwd: vscode.Uri;
    version: string;
    platform: ServerPlatform;

    constructor(extensionUri: vscode.Uri) {
        this.platform = ServerVersion.getServerPlatform();
        let userServerPathAndVersion = ServerVersion.getUserServerPathAndVersion(this.platform);
        if (userServerPathAndVersion) {
            this.version = userServerPathAndVersion[1];
            this.path = ServerVersion.getPlatformBinaryUri(extensionUri, userServerPathAndVersion[0], this.platform);
            this.cwd = ServerVersion.getPlatformBinaryDirectoryPath(extensionUri, userServerPathAndVersion[0], this.platform);
            if (!this.isValidVersion()) {
                vscode.window.showWarningMessage(`${this.version} is not compatible with this extension (Expecting ${ServerVersion.getBundledVersion()}). Server may crash or behave weirdly.`);
            }
        } else {
            // Get bundled version as user
            console.info(`No server path found. Using bundled server.`);
            this.version = ServerVersion.getBundledVersion();
            this.path = ServerVersion.getPlatformBinaryUri(extensionUri, null, this.platform);
            this.cwd = ServerVersion.getPlatformBinaryDirectoryPath(extensionUri, null, this.platform);
        }
    }
    private static getUserServerPathAndVersion(platform: ServerPlatform) : [string, string] | null {
        if (platform === ServerPlatform.wasi) {
            return null; // Bundled wasi version
        } else {
            // Check configuration.
            let serverPath = vscode.workspace.getConfiguration("shader-validator").get<string>("serverPath");
            if (serverPath && serverPath.length > 0) {
                let serverVersion = ServerVersion.getServerVersion(serverPath, platform);
                if (serverVersion) {
                    console.info(`shader-validator.serverPath found: ${serverPath}`);
                    return [serverPath, serverVersion];
                } else {
                    console.warn("shader-validator.serverPath not found.");
                }
            }
            // Check environment variables
            if (process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH !== undefined) {
                let envPath = process.env.SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH;
                let serverVersion = ServerVersion.getServerVersion(envPath, platform);
                if (serverVersion) {
                    console.info(`SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH found: ${envPath}`);
                    return [envPath, serverVersion];
                } else {
                    console.warn("SHADER_LANGUAGE_SERVER_EXECUTABLE_PATH server path not found.");
                }
            }
            // Use bundled executables.
            console.info("No server path user settings found. Using bundled executable.");
            return null;
        }
    }
    static getBundledVersion() : string {
        return "shader-language-server v" + vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
    }
    private static getServerVersion(serverPath: string | null, platform: ServerPlatform) : string | null {
        if (isRunningOnWeb() || platform === ServerPlatform.wasi || serverPath === null) {
            // Bundled version always used on the web as we cant access external folders.
            // For wasi, we need some runner to test version & we cant do this here. So ignore check.
            return this.getBundledVersion();
        } else {
            // Get the server version if using a custom server (if serverPath is not null)
            // If we are using the bundled server, we never reach this path. Good because its a bit heavy on startup.
            if (fs.existsSync(serverPath)) {
                const result = cp.execSync(serverPath + " --version");
                const version = result.toString("utf8").trim();
                return version;
            } else {
                return null;
            }
        }
    }
    private isValidVersion() {
        const requestedServerVersion = vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
        const versionExpected = "shader-language-server v" + requestedServerVersion;
        return this.version === versionExpected;
    }
    static getPlatformBinaryDirectoryPath(extensionUri: vscode.Uri, serverPath: string | null, platform: ServerPlatform) : vscode.Uri {
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
    static getPlatformBinaryName(serverPath: string | null, platform: ServerPlatform) : string {
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
    static getPlatformBinaryUri(extensionUri: vscode.Uri, serverPath: string | null, platform: ServerPlatform) : vscode.Uri {
        return vscode.Uri.joinPath(ServerVersion.getPlatformBinaryDirectoryPath(extensionUri, serverPath, platform), ServerVersion.getPlatformBinaryName(serverPath, platform));
    }
    static getServerPlatform() : ServerPlatform {
        let useWasiServer = vscode.workspace.getConfiguration("shader-validator").get<boolean>("useWasiServer")!;
        if (isRunningOnWeb() || useWasiServer) {
            return ServerPlatform.wasi;
        } else {
            // Dxc only built for linux x64 & windows x64. Fallback to WASI for every other situations.
            // TODO: ARM DLL available aswell, need to bundle them, along with correct version of server. 
            // Should have an extension version per platform.
            // Could have a setting for user provided DLL path aswell, but useless if server does not match the platform.
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
};

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
    private server: ShaderLanguageClient;
    constructor(server: ShaderLanguageClient) {
        this.server = server;
    }
    public error(_error: Error, _message: Message, count: number): ErrorHandlerResult {
        this.server.updateStatus(ServerStatus.error);
        return { action: ErrorAction.Shutdown };
    }
    public closed(): CloseHandlerResult {
        this.server.updateStatus(ServerStatus.error);
        return { action: CloseAction.DoNotRestart, message: `The shader language server crashed. Set shader-validator.trace.server to messages or verbose for more information.` }; 
    }
}

export class ShaderLanguageClient {
    private client: LanguageClient | null = null;
    private channel: vscode.OutputChannel | null = null;
    private errorHandler: ShaderErrorHandler;
    private serverVersion: ServerVersion;
    private serverStatus: ServerStatus = ServerStatus.stopped;
    private statusChangedCallback: (status: ServerStatus) => void;

    constructor(context: vscode.ExtensionContext) {
        this.statusChangedCallback = (status) => {};
        this.serverVersion = new ServerVersion(context.extensionUri);
        this.errorHandler = new ShaderErrorHandler(this);
    }

    onStatusChanged(statusChangedCallback: (status: ServerStatus) => void) {
        this.statusChangedCallback = statusChangedCallback;
    }

    async start(context: vscode.ExtensionContext, updateServerUsed: boolean): Promise<ServerStatus> {
        if (this.serverStatus === ServerStatus.running) {
            return ServerStatus.running;
        }
        let levelString = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server")!;
        let level = Trace.fromString(levelString);
        switch (level) {
            case Trace.Verbose:
            case Trace.Compact:
            case Trace.Messages:
                this.channel = vscode.window.createOutputChannel(getChannelName());
                break;
            case Trace.Off:
                this.channel = null;
                break;
        }
        if (updateServerUsed) {
            this.updateServerVersion(context.extensionUri);
        }
        this.client = await this.createLanguageClient(context);
        this.serverStatus = this.client !== null ? ServerStatus.running : ServerStatus.error;
        return this.serverStatus;
    }
    async restart(context: vscode.ExtensionContext) {
        await this.stop();
        await this.start(context, true);
    }
    async stop() {
        await this.client?.stop(100).catch(_ => {});
        this.dispose();
        this.serverStatus = ServerStatus.stopped;
    }
    updateServerVersion(extensionUri: vscode.Uri) {
        this.serverVersion = new ServerVersion(extensionUri);
    }
    updateStatus(status: ServerStatus) {
        this.serverStatus = status;
        this.statusChangedCallback(status);
    }
    getServerStatus(): ServerStatus {
        return this.serverStatus;
    }
    getServerPath(): vscode.Uri {
        return this.serverVersion.path;
    }
    getServerVersion(): string {
        return this.serverVersion.version;
    }
    showLogs() {
        if (this.channel) {
            this.channel.show(false);
        }
    }
    dispose() {
        this.client?.dispose(100).catch(_ => {});
        this.channel?.dispose();
    }
    sendNotification<P, RO>(type: ProtocolNotificationType<P, RO>, params?: P): Promise<void> {
        return this.client!.sendNotification(type, params);
    }
    sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P): Promise<R> {
        return this.client!.sendRequest(type, params);
    }
    uriAsString(uri: vscode.Uri): string {
        return this.client!.code2ProtocolConverter.asUri(uri);
    }
    stringAsUri(str: string): vscode.Uri {
        return this.client!.protocol2CodeConverter.asUri(str);
    }
    log(message: string) {
        if (this.channel) {
            this.channel.appendLine(message);
        }
    }
    static getSupportedLangId() {
        return ["hlsl", "glsl", "wgsl", "slang"];
    }
    static isEnabledLangId(langId: string) {
        let hlslSupported = vscode.workspace.getConfiguration("shader-validator").get<boolean>("hlsl.enabled")!;
        let slangSupported = vscode.workspace.getConfiguration("shader-validator").get<boolean>("slang.enabled")!;
        let glslSupported = vscode.workspace.getConfiguration("shader-validator").get<boolean>("glsl.enabled")!;
        let wgslSupported = vscode.workspace.getConfiguration("shader-validator").get<boolean>("wgsl.enabled")!;
        switch(langId) {
            case "hlsl": return hlslSupported;
            case "glsl": return glslSupported;
            case "wgsl": return wgslSupported;
            case "slang": return slangSupported;
            default: return false;
        }
    }
    static getTraceLevel(): Trace {
        let levelString = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server")!;
        return Trace.fromString(levelString);
    }

    private async createLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient | null> {
        // Create validator
        // Web does not support child process, use wasi instead.
        if (this.serverVersion.platform === ServerPlatform.wasi) {
            return this.createLanguageClientWASI(context);
        } else {
            return this.createLanguageClientStandard(context);
        }
    }
    private getClientOption() {
        // Pass languages that should be enabled to server.
        let documentSelector = [];
        for (var langId of ShaderLanguageClient.getSupportedLangId()) {
            if (ShaderLanguageClient.isEnabledLangId(langId)) {
                documentSelector.push({ scheme: 'file', language: langId });
            }
        }
        const clientOptions: LanguageClientOptions = {
            // Register the server for shader documents
            documentSelector: documentSelector,
            outputChannel: this.channel ? this.channel : undefined,
            traceOutputChannel: this.channel ? this.channel : undefined,
            middleware: getMiddleware(),
            uriConverters: this.serverVersion.platform === ServerPlatform.wasi ? createUriConverters() : undefined,
            errorHandler: this.errorHandler
        };
        return clientOptions;
    }
    private getServerArg(): string[] {
        let commonArgs = [
            "--config",
            getConfigurationAsString()
        ];
        // Add languages support for server.
        const supportedLangIds = ShaderLanguageClient.getSupportedLangId();
        let hasAtLeastOneLangEnabled = false;
        for (let supportedLangId of supportedLangIds) {
            if (ShaderLanguageClient.isEnabledLangId(supportedLangId)) {
                hasAtLeastOneLangEnabled = true;
                commonArgs.push("--" + supportedLangId);
            }
        }
        if (!hasAtLeastOneLangEnabled) {
            vscode.window.showWarningMessage("No language enabled for shader-language-server. Server will still start.");
        }
        return commonArgs;
    }
    private getServerEnv() {
        const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
        const defaultEnv = {
            // https://github.com/rust-lang/rust/issues/117440
            //"RUST_MIN_STACK": "65535", // eslint-disable-line @typescript-eslint/naming-convention
        };
        const env = (trace === "verbose") ? {
            ...defaultEnv,
            "RUST_BACKTRACE": "1", // eslint-disable-line 
            "RUST_LOG": "shader_language_server=trace,shader_sense=trace", // eslint-disable-line @typescript-eslint/naming-convention
        } : (trace === "messages") ? {
            ...defaultEnv,
            "RUST_BACKTRACE": "1", // eslint-disable-line 
            "RUST_LOG": "shader_language_server=info,shader_sense=info", // eslint-disable-line @typescript-eslint/naming-convention
        } : defaultEnv;
        return env;
    }
    private async createLanguageClientStandard(context: vscode.ExtensionContext) : Promise<LanguageClient | null> {
        console.info(`Executing server ${this.serverVersion.path} with working directory ${this.serverVersion.cwd}`);
        const serverOptions: ServerOptions = {
            command: this.serverVersion.path.fsPath, 
            transport: TransportKind.stdio,
            args: this.getServerArg(),
            options: {
                cwd: this.serverVersion.cwd.fsPath,
                env: this.getServerEnv(),
            }
        };
        const clientOptions = this.getClientOption();
        let client = new LanguageClient(
            'shader-validator',
            getChannelName(),
            serverOptions,
            clientOptions,
            context.extensionMode === vscode.ExtensionMode.Development 
        );

        // Start the client. This will also launch the server.
        return await client.start().then(_ => {
            if (client.isRunning()) {
                return client;
            } else {
                return null;
            }
        }, async e => {
            await client.dispose().catch(_ => {});
            console.error("Failed to start server: " + e);
            return null;
        });
    }
    private async createLanguageClientWASI(context: vscode.ExtensionContext) : Promise<LanguageClient | null> {
        // Load the WASM API
        const wasm: Wasm = await Wasm.load();

        // Load the WASM module. It is stored alongside the extension's JS code.
        // So we can use VS Code's file system API to load it. Makes it
        // independent of whether the code runs in the desktop or the web.
        const serverOptions: ServerOptions = async () => {
            const trace = vscode.workspace.getConfiguration("shader-validator").get<string>("trace.server");
            // Create virtual file systems to access workspaces from wasi app
            const mountPoints: MountPointDescriptor[] = [
                { kind: 'workspaceFolder'}, // Workspaces
            ];
            console.info(`Executing wasi server ${this.serverVersion.path}`);
            const bits = await vscode.workspace.fs.readFile(this.serverVersion.path);
            const bytes: ArrayBuffer = new Uint8Array(bits).buffer;
            const module = await WebAssembly.compile(bytes);

            const options : ProcessOptions = {
                stdio: createStdioOptions(),
                env: this.getServerEnv(),
                args: this.getServerArg(),
                mountPoints: mountPoints,
                trace: trace === "verbose" || trace === "messages",
            };
            // Memory options required by wasm32-wasip1-threads target
            const memory : WebAssembly.MemoryDescriptor = {
                initial: 160, 
                maximum: 1024, // Big enough to handle glslang heavy RAM usage.
                shared: true
            };

            // Create a WASM process.
            const wasmProcess = await wasm.createProcess('shader-validator', module, memory, options);
            
            // Hook stderr to the output channel if trace enabled.
            if (trace === "verbose" || trace === "messages") {
                const decoder = new TextDecoder('utf-8');
                wasmProcess.stderr!.onData(data => {
                    const text = decoder.decode(data);
                    console.log("Received error:", text);
                    this.channel?.appendLine("[shader-language-server::error]" + text.trim());
                });
                wasmProcess.stdout!.onData(data => {
                    const text = decoder.decode(data);
                    console.log("Received data:", text);
                    this.channel?.appendLine("[shader-language-server::data]" + text.trim());
                });
            }
            return startServer(wasmProcess);
        };

        // Now we start client
        const clientOptions = this.getClientOption();

        let client = new LanguageClient(
            'shader-validator',
            getChannelName(),
            serverOptions,
            clientOptions,
            context.extensionMode === vscode.ExtensionMode.Development 
        );
        
        // Start the client. This will also launch the server
        return await client.start().then(_ => {
            if (client.isRunning()) {
                return client;
            } else {
                return null;
            }
        }, async e => {
            await client.dispose().catch(_ => {});
            console.error("Failed to start server: " + e);
            return null;
        });
    }

}