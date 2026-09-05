import * as vscode from "vscode";
import * as cp from "child_process";
import fs from 'fs';
import path from 'path';

import {
    createMessageConnection,
    MessageConnection,
    NotificationType0,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-jsonrpc/node';

import { Trace } from 'vscode-languageclient';

import { isRunningOnWeb, resolveVSCodeVariables, ShaderLanguageClient } from "../../client";
import { CompileShaderResult } from "../../request";
import { ShaderStage } from "../variant/variant";
import {
    alignBytesPerRow,
    errorNotification,
    RendererShader,
    RendererShaderStage,
    renderRequest,
    rendererSurfaceBytesPerTexel,
    resizeTargetNotification,
    shutdownRequest,
    toRendererShaderSource,
    toRendererShaderStage,
    toRendererShadingLanguage,
    updateShaderNotification,
} from "./rendererProtocol";

export enum RendererStatus {
    running,
    stopped,
    error,
}

/// A frame read back from the renderer. Data is the base64 payload as received, so that it can be
/// handed over to a webview without a decode & re-encode round trip. Rows hold rendererSurfaceBytesPerTexel
/// wide texels in Rgba8Unorm, possibly padded up to bytesPerRow.
export interface RenderedFrame {
    width: number,
    height: number,
    bytesPerRow: number,
    data: string,
}

const exitNotification = new NotificationType0('exit');

/// Size used before the webview reported the one it can display.
const defaultRendererWidth = 1280;
const defaultRendererHeight = 720;
/// A frame is read back & base64 encoded on every render, so cap the target to keep the payload sane.
const maxRendererSize = 4096;

/// Keep a size the renderer can allocate a target for, whatever layout the webview reports.
function clampRendererSize(size: number): number {
    return Math.max(1, Math.min(maxRendererSize, Math.floor(size)));
}

function getChannelName(): string {
    return 'Shader renderer';
}

/// The renderer is a native process driving wgpu, so unlike the language server it has no wasi
/// fallback: it cannot run in the web extension host nor on platforms we do not ship a binary for.
export class RendererVersion {
    path: vscode.Uri;
    cwd: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        const userPath = RendererVersion.getUserRendererPath();
        this.path = RendererVersion.getPlatformBinaryUri(extensionUri, userPath);
        this.cwd = vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders[0].uri
            : RendererVersion.getPlatformBinaryDirectoryPath(extensionUri, userPath);
    }
    private static getUserRendererPath(): string | null {
        // Check configuration.
        const rendererPath = resolveVSCodeVariables(vscode.workspace.getConfiguration("shader-validator").get<string>("rendererPath")!);
        if (rendererPath && rendererPath.length > 0) {
            if (fs.existsSync(rendererPath)) {
                console.info(`shader-validator.rendererPath found: ${rendererPath}`);
                return rendererPath;
            } else {
                console.warn("shader-validator.rendererPath not found.");
            }
        }
        // Check environment variables.
        if (process.env.SHADER_RENDERER_EXECUTABLE_PATH !== undefined) {
            const envPath = process.env.SHADER_RENDERER_EXECUTABLE_PATH;
            if (fs.existsSync(envPath)) {
                console.info(`SHADER_RENDERER_EXECUTABLE_PATH found: ${envPath}`);
                return envPath;
            } else {
                console.warn("SHADER_RENDERER_EXECUTABLE_PATH renderer path not found.");
            }
        }
        // Use bundled executables.
        console.info("No renderer path user settings found. Using bundled executable.");
        return null;
    }
    static getPlatformBinaryDirectoryPath(extensionUri: vscode.Uri, rendererPath: string | null): vscode.Uri {
        if (rendererPath) {
            return vscode.Uri.file(path.dirname(rendererPath));
        } else {
            // CI is handling the copy to bin folder to avoid storage of exe on git.
            return vscode.Uri.joinPath(extensionUri, `bin/${process.platform}-${process.arch}/`);
        }
    }
    static getPlatformBinaryName(rendererPath: string | null): string {
        if (rendererPath) {
            return path.basename(rendererPath);
        } else {
            return process.platform === "win32" ? "shader-renderer.exe" : "shader-renderer";
        }
    }
    static getPlatformBinaryUri(extensionUri: vscode.Uri, rendererPath: string | null): vscode.Uri {
        return vscode.Uri.joinPath(RendererVersion.getPlatformBinaryDirectoryPath(extensionUri, rendererPath), RendererVersion.getPlatformBinaryName(rendererPath));
    }
    /// A renderer is only available when we can spawn a process for a platform we ship a binary for.
    static isPlatformSupported(): boolean {
        if (isRunningOnWeb()) {
            return false;
        }
        switch (process.platform) {
            case "win32":
                return process.arch === 'x64' || process.arch === 'arm64';
            case "linux":
                return process.arch === 'x64';
            default:
                return false;
        }
    }
}

/// Client driving the shader-renderer executable over its JSON RPC stdio transport.
///
/// The renderer owns the pipeline state, so the client is only responsible for keeping it in sync
/// with the shaders the language server compiled for us & for asking frames back.
export class ShaderRenderer {
    private extensionUri: vscode.Uri;
    /// Only resolved once we know the platform is supported: resolving it reads process & fs,
    /// which do not exist in the web extension host.
    private version: RendererVersion | null = null;
    private channel: vscode.OutputChannel;
    private process: cp.ChildProcess | null = null;
    private connection: MessageConnection | null = null;
    private status: RendererStatus = RendererStatus.stopped;
    private statusChangedCallback: (status: RendererStatus) => void = _ => {};
    /// Size of the render target, driven by the webview layout. Kept across restarts so that the
    /// renderer is spawned with the size the panel is currently displaying.
    private width: number;
    private height: number;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
        this.channel = vscode.window.createOutputChannel(getChannelName());
        // Fallback size, only used until the webview reported its own.
        this.width = defaultRendererWidth;
        this.height = defaultRendererHeight;
        context.subscriptions.push(this.channel);
    }

    onStatusChanged(statusChangedCallback: (status: RendererStatus) => void) {
        this.statusChangedCallback = statusChangedCallback;
    }
    getStatus(): RendererStatus {
        return this.status;
    }
    /// Path of the executable backing the renderer, null until it has been started once.
    getRendererPath(): vscode.Uri | null {
        return this.version?.path || null;
    }
    getSize(): [number, number] {
        return [this.width, this.height];
    }
    log(message: string) {
        this.channel.appendLine(message);
    }
    showLogs() {
        this.channel.show(false);
    }

    /// Build the env_logger filter for the renderer process.
    ///
    /// wgpu & naga log the reason a shader or a pipeline was rejected under their own targets, so
    /// they have to be part of the filter or a failing render comes with no explanation at all.
    static getLogFilter(): string {
        switch (ShaderLanguageClient.getTraceLevel()) {
            case Trace.Verbose:
                return "shader_renderer=trace,wgpu=debug,wgpu_core=debug,wgpu_hal=debug,naga=debug";
            case Trace.Compact:
            case Trace.Messages:
                return "shader_renderer=debug,wgpu=info,wgpu_core=info,wgpu_hal=info,naga=info";
            default:
                return "shader_renderer=info,wgpu=warn,wgpu_core=warn,wgpu_hal=warn,naga=warn";
        }
    }

    private updateStatus(status: RendererStatus) {
        if (this.status !== status) {
            this.status = status;
            this.statusChangedCallback(status);
        }
    }

    async start(): Promise<RendererStatus> {
        if (this.status === RendererStatus.running) {
            return RendererStatus.running;
        }
        if (!RendererVersion.isPlatformSupported()) {
            this.log(`Renderer is not supported on ${isRunningOnWeb() ? "web" : `${process.platform}-${process.arch}`}.`);
            this.updateStatus(RendererStatus.error);
            return RendererStatus.error;
        }
        // Drop a previously errored process before starting a new one.
        this.terminate();
        // Resolve the executable on every start so that a setting update is picked up.
        this.version = new RendererVersion(this.extensionUri);
        const rendererPath = this.version.path.fsPath;
        const cwd = this.version.cwd.fsPath;
        if (!fs.existsSync(rendererPath)) {
            this.log(`Renderer executable not found at ${rendererPath}. Set shader-validator.rendererPath to point to a shader-renderer build.`);
            this.updateStatus(RendererStatus.error);
            return RendererStatus.error;
        }
        this.log(`Executing renderer ${rendererPath} with working directory ${cwd}`);
        const renderer = cp.spawn(rendererPath, [
            "--stdio",
            "--width", this.width.toString(),
            "--height", this.height.toString(),
        ], {
            cwd: cwd,
            env: {
                ...process.env,
                "RUST_BACKTRACE": "1", // eslint-disable-line @typescript-eslint/naming-convention
                "RUST_LOG": ShaderRenderer.getLogFilter(), // eslint-disable-line @typescript-eslint/naming-convention
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!renderer.pid || !renderer.stdin || !renderer.stdout) {
            this.log(`Failed to spawn renderer ${rendererPath}.`);
            this.updateStatus(RendererStatus.error);
            return RendererStatus.error;
        }
        renderer.on('error', error => {
            this.log(`Renderer process failed: ${error.message}`);
            this.updateStatus(RendererStatus.error);
        });
        renderer.on('exit', (code, signal) => {
            // An expected exit already cleared the process in stop().
            if (this.process === renderer) {
                this.log(`Renderer process exited with code ${code} (signal ${signal}).`);
                this.terminate();
                this.updateStatus(RendererStatus.error);
            }
        });
        // stderr carries the renderer logs, they are not part of the RPC stream.
        renderer.stderr?.on('data', (data: Buffer) => {
            this.log(`[shader-renderer] ${data.toString('utf8').trimEnd()}`);
        });

        this.process = renderer;
        this.connection = createMessageConnection(
            new StreamMessageReader(renderer.stdout),
            new StreamMessageWriter(renderer.stdin),
            {
                error: message => this.log(`[error] ${message}`),
                warn: message => this.log(`[warn] ${message}`),
                info: message => this.log(`[info] ${message}`),
                log: message => this.log(`[log] ${message}`),
            }
        );
        // The renderer reports failures it could not attach to a request as a notification.
        this.connection.onNotification(errorNotification, params => {
            this.log(`Renderer error: ${params.message}`);
            vscode.window.showErrorMessage(`Shader renderer: ${params.message}`);
        });
        this.connection.onError(([error]) => {
            this.log(`Connection to renderer failed: ${error.message}`);
            this.updateStatus(RendererStatus.error);
        });
        this.connection.onClose(() => {
            if (this.status === RendererStatus.running) {
                this.log("Connection to renderer closed unexpectedly.");
                this.updateStatus(RendererStatus.error);
            }
        });
        this.connection.listen();
        this.updateStatus(RendererStatus.running);
        return RendererStatus.running;
    }

    async stop() {
        const connection = this.connection;
        if (connection) {
            // Renderer relies on lsp-server, which expects the shutdown & exit sequence to leave its loop.
            await connection.sendRequest(shutdownRequest).then(_ => {
                return connection.sendNotification(exitNotification);
            }, (reason: any) => {
                this.log(`Failed to shutdown renderer: ${reason}`);
            });
        }
        this.terminate();
        this.updateStatus(RendererStatus.stopped);
    }

    async restart(): Promise<RendererStatus> {
        await this.stop();
        return this.start();
    }

    /// Drop the process & its connection without any handshake.
    private terminate() {
        this.connection?.dispose();
        this.connection = null;
        const renderer = this.process;
        this.process = null;
        if (renderer && renderer.exitCode === null) {
            renderer.kill();
        }
    }

    /// Resize the render target. Takes effect on the next rendered frame.
    ///
    /// A stopped renderer only records the size, so that it is spawned with it once started.
    /// @returns Whether the size changed.
    async resize(width: number, height: number): Promise<boolean> {
        const clampedWidth = clampRendererSize(width);
        const clampedHeight = clampRendererSize(height);
        if (this.width === clampedWidth && this.height === clampedHeight) {
            return false;
        }
        this.width = clampedWidth;
        this.height = clampedHeight;
        await this.connection?.sendNotification(resizeTargetNotification, {
            width: this.width,
            height: this.height,
        });
        return true;
    }

    /// Bind a shader to a stage of the renderer pipeline.
    async updateShader(stage: RendererShaderStage, shader: RendererShader | null) {
        await this.requireConnection().sendNotification(updateShaderNotification, {
            shader_stage: stage, // eslint-disable-line @typescript-eslint/naming-convention
            shader: shader,
        });
    }

    /// Unbind whatever shader is currently bound to a stage.
    async removeShader(stage: RendererShaderStage) {
        await this.updateShader(stage, null);
    }

    /// Bind a compilation result coming from the language server to a stage of the renderer pipeline.
    /// @throws {Error} If the shader cannot be expressed as a renderer shader.
    async updateCompiledShader(languageId: string, stage: ShaderStage, entryPoint: string, result: CompileShaderResult) {
        const shadingLanguage = toRendererShadingLanguage(languageId);
        if (shadingLanguage === null) {
            throw new Error(`Language ${languageId} is not a shading language the renderer supports.`);
        }
        const rendererStage = toRendererShaderStage(stage);
        if (rendererStage === null) {
            throw new Error(`Shader stage ${ShaderStage[stage]} cannot be mapped to a renderer pipeline stage. Set an explicit stage on the shader variant.`);
        }
        await this.updateShader(rendererStage, {
            shading_language: shadingLanguage, // eslint-disable-line @typescript-eslint/naming-convention
            stage: rendererStage,
            entry_point: entryPoint, // eslint-disable-line @typescript-eslint/naming-convention
            source: toRendererShaderSource(result),
        });
    }

    /// Render a frame with the currently bound shaders & read it back.
    /// @throws {Error} If the renderer failed to render or returned a payload we cannot interpret.
    async render(): Promise<RenderedFrame> {
        const result = await this.requireConnection().sendRequest(renderRequest);
        return {
            width: this.width,
            height: this.height,
            bytesPerRow: this.getFrameBytesPerRow(base64ByteLength(result.data)),
            data: result.data,
        };
    }

    /// Rows of a texture read back from wgpu can be padded, so deduce the row pitch from the payload
    /// size instead of assuming a tightly packed image.
    private getFrameBytesPerRow(byteLength: number): number {
        const tightBytesPerRow = this.width * rendererSurfaceBytesPerTexel;
        const paddedBytesPerRow = alignBytesPerRow(this.width);
        if (byteLength === tightBytesPerRow * this.height) {
            return tightBytesPerRow;
        } else if (byteLength === paddedBytesPerRow * this.height) {
            return paddedBytesPerRow;
        } else {
            throw new Error(`Renderer returned ${byteLength} bytes, which does not match a ${this.width}x${this.height} Rgba8Unorm image (expected ${tightBytesPerRow * this.height} or ${paddedBytesPerRow * this.height} bytes).`);
        }
    }

    private requireConnection(): MessageConnection {
        if (this.connection === null) {
            throw new Error("Renderer is not running.");
        }
        return this.connection;
    }

    dispose() {
        this.terminate();
    }
}

/// Size of the payload a base64 string decodes to, without decoding it.
function base64ByteLength(data: string): number {
    let padding = 0;
    for (let i = data.length - 1; i >= 0 && data[i] === '='; i--) {
        padding++;
    }
    return Math.floor(data.length / 4) * 3 - padding;
}
