import * as vscode from "vscode";

import { ShaderLanguageClient, ServerStatus } from "../../client";
import { CompileShaderResult } from "../../request";
import { sidebar } from "../../extension";
import { RenderedFrame, RendererStatus, ShaderRenderer } from "./renderer";
import { rendererSurfaceBytesPerTexel } from "./rendererProtocol";

/// Messages sent to the webview.
type RendererViewMessage =
    { kind: 'frame', frame: RenderedFrame, bytesPerTexel: number, description: string } |
    { kind: 'status', message: string, isError: boolean };

/// Panel displaying the frames read back from the renderer.
///
/// A frame is produced by binding the active shader variant compilation result to its pipeline stage,
/// then asking the renderer for a render. Bindings are kept across renders, so a graphic pipeline is
/// assembled by activating & rendering each of its stages one after the other.
export class ShaderRendererView {
    private context: vscode.ExtensionContext;
    private server: ShaderLanguageClient;
    private renderer: ShaderRenderer;
    private panel: vscode.WebviewPanel | null = null;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient, renderer: ShaderRenderer) {
        this.context = context;
        this.server = server;
        this.renderer = renderer;
        this.renderer.onStatusChanged(status => {
            if (status === RendererStatus.error) {
                this.postStatus("Renderer stopped. Check the shader renderer logs.", true);
            }
        });
    }

    /// Open the renderer panel, or reveal it if it is already opened.
    async show() {
        if (this.panel) {
            this.panel.reveal();
            await this.render();
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
        }
    }

    /// Bind the active shader variant & render a frame into the panel. Does nothing if no panel is opened.
    async render() {
        if (this.panel === null) {
            return;
        }
        try {
            const frame = await this.renderActiveVariant();
            if (frame) {
                this.post({
                    kind: 'frame',
                    frame: frame.frame,
                    bytesPerTexel: rendererSurfaceBytesPerTexel,
                    description: frame.description,
                });
            }
        } catch (error: any) {
            const message = error instanceof Error ? error.message : `${error}`;
            this.renderer.log(`Failed to render: ${message}`);
            this.postStatus(message, true);
        }
    }
    
    /// Resize the render target to the size the webview viewport can display & render a frame at it.
    ///
    /// The webview debounces its reports, so a render per resize is not a render per layout pass.
    async resizeRenderer(width: number, height: number) {
        if (this.panel === null) {
            return;
        }
        await this.renderer.resize(width, height);
        await this.render();
    }

    /// @throws {Error} If the renderer could not be started, fed a shader or render a frame.
    private async renderActiveVariant(): Promise<{ frame: RenderedFrame, description: string } | null> {
        if (this.server.getServerStatus() !== ServerStatus.running) {
            this.postStatus("Language server is not running, cannot compile a shader to render.", true);
            return null;
        }
        const variant = sidebar.getActiveVariant();
        if (variant === null) {
            this.postStatus("No active shader variant. Compile a variant from the shader variant view to render it.", false);
            return null;
        }
        if (await this.renderer.start() !== RendererStatus.running) {
            throw new Error("Failed to start the renderer. Check the shader renderer logs.");
        }
        this.postStatus(`Compiling ${variant.name}...`, false);
        const compilation = (await vscode.commands.executeCommand(
            'shader-validator.compileShader',
            variant.uri
        )) as CompileShaderResult | null;
        if (compilation === null) {
            throw new Error(`Failed to compile ${variant.name}. Check the diagnostics of the shader.`);
        }
        const document = await vscode.workspace.openTextDocument(variant.uri);
        await this.renderer.updateCompiledShader(document.languageId, variant.stage.stage, variant.name, compilation);
        this.postStatus(`Rendering ${variant.name}...`, false);
        const frame = await this.renderer.render();
        return {
            frame: frame,
            description: `${variant.name} (${compilation.compilationType}) ${frame.width}x${frame.height}`,
        };
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
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            height: calc(100vh - 16px);
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }
        #toolbar {
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
