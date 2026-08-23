import * as vscode from 'vscode';
import { HostMessage, ShaderSource, WebviewMessage } from './protocol';

// Hosts the WebGPU renderer running in `src/view/renderer/webview/main.ts`.
// Only one panel is kept around: showing it again reveals and retargets the existing one.
export class ShaderRendererPanel {
    private static readonly viewType = 'shader-validator.renderer';
    private static current: ShaderRendererPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly disposables: vscode.Disposable[] = [];
    // vscode tears the webview down whenever the panel goes to the background, so the
    // shader is kept here to be pushed again every time the webview reports itself ready.
    private shader: ShaderSource | undefined;

    static show(context: vscode.ExtensionContext, shader?: ShaderSource): ShaderRendererPanel {
        if (ShaderRendererPanel.current) {
            ShaderRendererPanel.current.panel.reveal(undefined, true);
            if (shader) {
                ShaderRendererPanel.current.setShader(shader);
            }
            return ShaderRendererPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            ShaderRendererPanel.viewType,
            'Shader renderer',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
            }
        );
        ShaderRendererPanel.current = new ShaderRendererPanel(panel, context.extensionUri, shader);
        return ShaderRendererPanel.current;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, shader?: ShaderSource) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.shader = shader;

        this.panel.webview.html = this.getHtml(this.panel.webview);
        this.disposables.push(this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
            this.onMessage(message);
        }));
        this.disposables.push(this.panel.onDidDispose(() => this.dispose()));
    }

    setShader(shader: ShaderSource) {
        this.shader = shader;
        this.post({ type: 'setShader', shader: shader });
    }

    setPaused(paused: boolean) {
        this.post({ type: 'setPaused', paused: paused });
    }

    dispose() {
        if (ShaderRendererPanel.current === this) {
            ShaderRendererPanel.current = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
        this.panel.dispose();
    }

    private post(message: HostMessage) {
        // Silently dropped while the webview is in the background, hence the replay on ready.
        this.panel.webview.postMessage(message);
    }

    private onMessage(message: WebviewMessage) {
        switch (message.type) {
            case 'ready':
                if (this.shader) {
                    this.post({ type: 'setShader', shader: this.shader });
                }
                break;
            case 'log':
                console.info('shader renderer: ' + message.message);
                break;
            case 'error':
                // Also displayed as an overlay in the panel itself.
                console.error('shader renderer: ' + message.message);
                break;
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const script = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'renderer.js')
        );
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Shader renderer</title>
    <style nonce="${nonce}">
        html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        body {
            display: flex;
            flex-direction: column;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        #canvas {
            display: block;
            flex: 1 1 auto;
            width: 100%;
            min-height: 0;
        }
        #status {
            flex: 0 0 auto;
            padding: 2px 6px;
            color: var(--vscode-descriptionForeground);
            border-top: 1px solid var(--vscode-panel-border);
            font-family: var(--vscode-editor-font-family);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #error {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            margin: 0;
            padding: 8px;
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow: auto;
            max-height: 50%;
        }
        #error[hidden] {
            display: none;
        }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    <div id="status">initializing webgpu...</div>
    <pre id="error" hidden></pre>
    <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }
}

// The content security policy only lets through the scripts and styles carrying this nonce.
function getNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
