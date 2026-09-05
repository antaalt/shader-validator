import * as vscode from "vscode";

import { ShaderLanguageClient, ServerStatus } from "../../client";
import { CompileShaderResult } from "../../request";
import { RenderedFrame, RendererStatus, ShaderRenderer } from "./renderer";
import { rendererSurfaceBytesPerTexel } from "./rendererProtocol";
import { ShaderStage, ShaderVariant } from "../variant/variant";

/// Messages sent to the webview.
type RendererViewMessage =
    { kind: 'frame', frame: RenderedFrame, bytesPerTexel: number, description: string } |
    { kind: 'status', message: string, isError: boolean };

/// Panel displaying the frames read back from the renderer.
///
/// A frame is produced by binding the shader variant of each pipeline stage, then asking the
/// renderer for a render. Bindings are kept across renders and are chosen from the renderer
/// settings view, which is the only place they are edited from.
export class ShaderRendererView {
    private context: vscode.ExtensionContext;
    private renderer: ShaderRenderer;
    private panel: vscode.WebviewPanel | null = null;
    private stageBindings: Map<ShaderStage, ShaderVariant>;

    private onDidChangeStageBindingsEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    /// Fired whenever the variant bound to a stage changed, so views displaying the bindings can
    /// follow them.
    readonly onDidChangeStageBindings: vscode.Event<void> = this.onDidChangeStageBindingsEmitter.event;

    constructor(context: vscode.ExtensionContext, renderer: ShaderRenderer) {
        this.context = context;
        this.renderer = renderer;
        this.renderer.onStatusChanged(status => {
            if (status === RendererStatus.error) {
                this.postStatus("Renderer stopped. Check the shader renderer logs.", true);
            }
        });
        this.stageBindings = new Map;
        vscode.workspace.onDidSaveTextDocument(async document => {
            // If we save one of the watched files, update renderer. A file can hold the variants of
            // multiple stages, so refresh every stage it is bound to.
            let stages = this.getStagesForUri(document.uri);
            if (stages.length > 0) {
                this.updateShadersAndRender(stages);
            }
        });
    }

    /// Variant bound to each stage of the renderer pipeline.
    getShaderVariants(): ReadonlyMap<ShaderStage, ShaderVariant> {
        return this.stageBindings;
    }
    /// Variant bound to a stage of the renderer pipeline, if any.
    getShaderVariant(stage: ShaderStage): ShaderVariant | undefined {
        return this.stageBindings.get(stage);
    }
    async setShaderVariant(stage: ShaderStage, variant: ShaderVariant | null) {
        console.assert(stage !== ShaderStage.auto, "Shader stage auto is not supported for renderer");
        console.info(`Set shader ${variant?.name} for stage ${ShaderStage[stage]} in renderer`);
        if (variant === null) {
            if (!this.stageBindings.delete(stage)) {
                return; // Nothing was bound to this stage.
            }
        } else {
            this.stageBindings.set(stage, variant);
        }
        this.onDidChangeStageBindingsEmitter.fire();
        await this.updateShadersAndRender([stage]);
    }
    /// Stages a file is bound to, as variants of a same file can be bound to more than one of them.
    private getStagesForUri(uri: vscode.Uri): ShaderStage[] {
        let stages: ShaderStage[] = [];
        for (let [stage, variant] of this.stageBindings) {
            if (variant.uri.toString() === uri.toString()) {
                stages.push(stage);
            }
        }
        return stages;
    }

    async tryRendererRequest(callback: () => void) {
        try {
            // A renderer which is not running has nothing to update: bindings are pushed to it on start.
            if (this.renderer.getStatus() !== RendererStatus.running) {
                throw Error("Renderer is not running.");
            }
            await callback();
        } catch (error: any) {
            const message = error instanceof Error ? error.message : `${error}`;
            this.renderer.log(`Renderer request failed: ${message}`);
            this.postStatus(message, true);
        }
    }

    /// Open the renderer panel, or reveal it if it is already opened.
    async show() {
        if (this.panel) {
            this.panel.reveal();
            await this.tryRendererRequest(() => {
                this.render();
            })
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'shader-validator.renderer',
                'Shader renderer',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    // Frames are only pushed on render, so the canvas content must survive a hidden panel.
                    retainContextWhenHidden: true,
                }
            );
            this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'res/icons/hlsl-icon.svg');
            this.panel.webview.html = this.getHtml(this.panel.webview);
            this.panel.webview.onDidReceiveMessage(async message => {
                switch (message.kind) {
                    case 'resize':
                        await this.resizeRenderer(message.width, message.height);
                        break;
                    case 'render':
                        await this.render();
                        break;
                    case 'showLogs':
                        this.renderer.showLogs();
                        break;
                    default:
                        console.warn("Unhandled message from renderer webview: ", message);
                        break;
                }
            }, undefined, this.context.subscriptions);
            this.panel.onDidDispose(() => {
                this.panel = null;
                // Keep no renderer process alive for a panel the user closed.
                this.renderer.stop();
            }, undefined, this.context.subscriptions);
            // No render here: the webview posts its viewport size once laid out, which renders a
            // first frame at the size the panel can actually display.

            // Start renderer as soon as we open the view to correctly update shaders.
            if (this.renderer.getStatus() !== RendererStatus.running) {
                if (await this.renderer.start() !== RendererStatus.running) {
                    console.error("Failed to start the renderer. Check the shader renderer logs.");
                } else {
                    // Pass all shaders stored to the server.
                    await this.updateAllShadersAndRender();
                }
            }
        }
    }

    /// Bind the active shader variant & render a frame into the panel. Does nothing if no panel is opened.
    // @throw Error if failed to render shaders
    async render() {
        if (this.panel === null) {
            return;
        }
        if (this.renderer.getStatus() !== RendererStatus.running) {
            this.postStatus("Renderer is not running, cannot render a shader.", true);
            return null;
        }
        this.postStatus(`Rendering...`, false);
        const frame = await this.renderer.render();
        if (frame) {
            this.post({
                kind: 'frame',
                frame: frame,
                bytesPerTexel: rendererSurfaceBytesPerTexel,
                description: `Resolution: ${frame.width}x${frame.height}`,
            });
        }
    }
    
    // Update the shader for given stage and notify renderer
    // @throw Error if failed to update shader
    private async updateShader(stage: ShaderStage) {
        if (this.renderer.getStatus() !== RendererStatus.running) {
            throw Error("Renderer is not running, cannot update a shader to render.");
        }
        console.assert(stage !== ShaderStage.auto, "Shader stage auto is not suppported for renderer");
        let variant = this.stageBindings.get(stage);
        if (variant === undefined) {
            // An unbound stage falls back to the default shader of the renderer for it.
            await this.renderer.removeShader(stage);
            return;
        }
        const document = await vscode.workspace.openTextDocument(variant.uri);
        function capitalizeFirstLetter(str: string): string {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }
        this.postStatus(`Compiling ${variant.name}...`, false);
        await this.renderer.updateShader(stage, {
            shadingLanguage: capitalizeFirstLetter(document.languageId), // Server expect it this way.
            stage: ShaderStage[stage],
            entryPoint: variant.name,
            filePath: document.uri.path,
            content: document.getText(),
            includes: variant.includes.includes.map(i => i.include),
            defines: Object.fromEntries(variant.defines.defines.map(d => [d.label, d.value] ))
        });
    }

    /// Push the shaders bound to the given stages to the renderer & render a frame out of them.
    async updateAllShadersAndRender() {
        this.updateShadersAndRender(Array.from(this.stageBindings.keys()));
    }
    /// Push the shaders bound to the given stages to the renderer & render a frame out of them.
    private async updateShadersAndRender(stages: ShaderStage[]) {
        await this.tryRendererRequest(async () => {
            for (let stage of stages) {
                await this.updateShader(stage);
            }
            await this.render();
        });
    }

    /// Resize the render target to the size the webview viewport can display & render a frame at it.
    ///
    /// The webview debounces its reports, so a render per resize is not a render per layout pass.
    async resizeRenderer(width: number, height: number) {
        if (this.panel === null) {
            return;
        }
        let resized = await this.renderer.resize(width, height);
        if (resized) {
            await this.render();
        }
    }

    private post(message: RendererViewMessage) {
        this.panel?.webview.postMessage(message);
    }
    private postStatus(message: string, isError: boolean) {
        this.post({ kind: 'status', message: message, isError: isError });
    }

    private getHtml(webview: vscode.Webview): string {
        // Inline script, so restrict the content security policy to it.
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shader renderer</title>
    <style nonce="${nonce}">
        body {
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }
        #toolbar {
            padding: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
        }
        button {
            color: var(--vscode-button-foreground);
            background-color: var(--vscode-button-background);
            border: none;
            padding: 4px 10px;
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #status {
            flex: 1 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #status.error {
            color: var(--vscode-errorForeground);
        }
        #viewport {
            flex: 1 1 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
            background-color: var(--vscode-editor-background);
            background-image: linear-gradient(45deg, var(--vscode-editorWidget-background) 25%, transparent 25%, transparent 75%, var(--vscode-editorWidget-background) 75%),
                              linear-gradient(45deg, var(--vscode-editorWidget-background) 25%, transparent 25%, transparent 75%, var(--vscode-editorWidget-background) 75%);
            background-size: 16px 16px;
            background-position: 0 0, 8px 8px;
        }
        #target {
            width: 100%;
            height: 100%;
            object-fit: contain;
            image-rendering: pixelated;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button id="render">Render</button>
        <span id="status">Waiting for a shader to render.</span>
        <button id="logs">Logs</button>
    </div>
    <div id="viewport">
        <canvas id="target" width="0" height="0"></canvas>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const canvas = document.getElementById('target');
        const viewport = document.getElementById('viewport');
        const context = canvas.getContext('2d');
        const status = document.getElementById('status');
        let lastFrame = null;
        let reportedWidth = 0;
        let reportedHeight = 0;
        let resizeTimeout = null;

        // The render target follows the viewport, so that a frame is rendered at the resolution it
        // is displayed at instead of a fixed one being scaled up or down.
        function reportViewportSize() {
            resizeTimeout = null;
            // A hidden panel lays its viewport out at zero, which is no size to render at.
            const width = Math.floor(viewport.clientWidth);
            const height = Math.floor(viewport.clientHeight);
            if (width <= 0 || height <= 0) {
                return;
            }
            if (width === reportedWidth && height === reportedHeight) {
                return;
            }
            reportedWidth = width;
            reportedHeight = height;
            vscode.postMessage({ kind: 'resize', width: width, height: height });
        }

        // Dragging a panel border lays out on every frame, but each report costs a compile & a
        // render, so only the size the layout settled on is reported.
        const resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout !== null) {
                clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(reportViewportSize, 200);
        });
        resizeObserver.observe(viewport);
        // Report the initial layout right away, so that the first frame does not wait for the debounce.
        reportViewportSize();

        document.getElementById('render').addEventListener('click', () => {
            vscode.postMessage({ kind: 'render' });
        });
        document.getElementById('logs').addEventListener('click', () => {
            vscode.postMessage({ kind: 'showLogs' });
        });

        function setStatus(message, isError) {
            status.textContent = message;
            status.classList.toggle('error', isError === true);
        }

        function draw(frame, bytesPerTexel) {
            const bytes = decodeBase64(frame.data);
            const image = context.createImageData(frame.width, frame.height);
            // Rows read back from the renderer can be padded, so copy them one by one.
            for (let y = 0; y < frame.height; y++) {
                const source = y * frame.bytesPerRow;
                const destination = y * frame.width * 4;
                for (let x = 0; x < frame.width; x++) {
                    const texel = source + x * bytesPerTexel;
                    const pixel = destination + x * 4;
                    image.data[pixel + 0] = bytes[texel + 0];
                    image.data[pixel + 1] = bytes[texel + 1];
                    image.data[pixel + 2] = bytes[texel + 2];
                    image.data[pixel + 3] = 255;
                }
            }
            canvas.width = frame.width;
            canvas.height = frame.height;
            context.putImageData(image, 0, 0);
        }

        function decodeBase64(data) {
            const binary = atob(data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.kind) {
                case 'frame':
                    try {
                        draw(message.frame, message.bytesPerTexel);
                        lastFrame = message;
                        setStatus(message.description, false);
                    } catch (error) {
                        setStatus('Failed to display frame: ' + error.message, true);
                    }
                    break;
                case 'status':
                    setStatus(message.message, message.isError);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    dispose() {
        this.onDidChangeStageBindingsEmitter.dispose();
        this.panel?.dispose();
    }
}

function getNonce(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return nonce;
}
