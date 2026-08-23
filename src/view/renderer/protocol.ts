// Messages exchanged between the extension host and the renderer webview.
// The webview is torn down by vscode every time the panel goes to the background,
// so it announces itself with `ready` and the host replays its state from there.

export interface ShaderSource {
    // Complete WGSL module. It must expose both entry points below.
    code: string,
    // Displayed in the webview status line, usually the shader file name.
    label: string,
    // Default to vs_main / fs_main when left out.
    vertexEntryPoint?: string,
    fragmentEntryPoint?: string,
}

// Extension host -> webview.
export type HostMessage =
    | { type: 'setShader', shader: ShaderSource }
    | { type: 'setPaused', paused: boolean };

// Webview -> extension host.
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'log', message: string }
    | { type: 'error', message: string };
