/// <reference types="@webgpu/types" />

import { HostMessage, ShaderSource, WebviewMessage } from '../protocol';

// Injected in the global scope of every vscode webview.
declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };

const host = acquireVsCodeApi();

const DEFAULT_VERTEX_ENTRY_POINT = 'vs_main';
const DEFAULT_FRAGMENT_ENTRY_POINT = 'fs_main';

// struct Uniforms { resolution : vec2f, time : f32, frame : f32 }, tightly packed.
const UNIFORM_SIZE = 16;

// A frame longer than this is assumed to be the panel coming back from the
// background: shader time is held back instead of jumping by the whole gap.
const MAX_FRAME_DELTA_SECONDS = 0.1;

const DEFAULT_SHADER: ShaderSource = {
    label: 'built-in',
    code: `struct Uniforms {
    resolution : vec2f,
    time : f32,
    frame : f32,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

// Fullscreen triangle: three vertices big enough to cover all of clip space.
@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> @builtin(position) vec4f {
    let x = f32(index / 2u) * 4.0 - 1.0;
    let y = f32(index & 1u) * 4.0 - 1.0;
    return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) position : vec4f) -> @location(0) vec4f {
    let uv = position.xy / uniforms.resolution;
    let phase = vec3f(uv.x, uv.y, uv.x + uv.y) * 6.2831853 + vec3f(0.0, 2.0, 4.0);
    return vec4f(0.5 + 0.5 * cos(uniforms.time + phase), 1.0);
}
`,
};

interface Statistics {
    label: string,
    width: number,
    height: number,
    framePerSecond: number,
}

// Renders a single fullscreen draw call, with the uniforms above bound at @group(0) @binding(0).
class WebGpuRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly device: GPUDevice;
    private readonly context: GPUCanvasContext;
    private readonly format: GPUTextureFormat;
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly bindGroup: GPUBindGroup;
    private readonly uniformBuffer: GPUBuffer;
    private readonly uniforms = new DataView(new ArrayBuffer(UNIFORM_SIZE));
    private readonly resizeObserver: ResizeObserver;

    private pipeline: GPURenderPipeline | null = null;
    private animationFrame: number | null = null;
    private lastTimestamp: number | null = null;
    private elapsed = 0; // Shader time in seconds, paused frames excluded.
    private frameIndex = 0;
    private framePerSecond = 0;
    private label = DEFAULT_SHADER.label;
    private onStatistics: ((statistics: Statistics) => void) | null = null;

    static async create(canvas: HTMLCanvasElement): Promise<WebGpuRenderer> {
        if (!navigator.gpu) {
            throw new Error(
                'WebGPU is not available in this webview. It requires a recent vscode build with ' +
                'hardware acceleration enabled, or a WebGPU capable browser when running vscode web.'
            );
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('No WebGPU adapter available. The GPU might be blocklisted by the driver.');
        }
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        if (!context) {
            throw new Error('Failed to acquire a webgpu context from the canvas.');
        }
        return new WebGpuRenderer(canvas, device, context);
    }

    private constructor(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext) {
        this.canvas = canvas;
        this.device = device;
        this.context = context;
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.uniformBuffer = device.createBuffer({
            label: 'uniforms',
            size: UNIFORM_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'uniforms',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            }],
        });
        this.bindGroup = device.createBindGroup({
            label: 'uniforms',
            layout: this.bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
        });

        // Configured once: getCurrentTexture keeps following the canvas size across resizes.
        this.context.configure({ device, format: this.format, alphaMode: 'opaque' });

        this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver.observe(canvas);
        this.resizeCanvas();

        device.lost.then(info => {
            this.stop();
            host.postMessage({ type: 'error', message: `WebGPU device lost (${info.reason}): ${info.message}` });
        });
        device.onuncapturederror = event => {
            host.postMessage({ type: 'error', message: `WebGPU error: ${event.error.message}` });
        };
    }

    getFormat(): GPUTextureFormat {
        return this.format;
    }

    setStatisticsListener(listener: (statistics: Statistics) => void) {
        this.onStatistics = listener;
    }

    // Rejects with the WGSL diagnostics when the module does not compile, keeping the
    // previous pipeline in place so that a broken edit does not blank the panel.
    async setShader(shader: ShaderSource) {
        const module = this.device.createShaderModule({ label: shader.label, code: shader.code });
        const info = await module.getCompilationInfo();
        const format = (message: GPUCompilationMessage) =>
            `${shader.label}:${message.lineNum}:${message.linePos}: ${message.type}: ${message.message}`;
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length > 0) {
            throw new Error(errors.map(format).join('\n'));
        }
        for (const message of info.messages) {
            host.postMessage({ type: 'log', message: format(message) });
        }
        this.pipeline = await this.device.createRenderPipelineAsync({
            label: shader.label,
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            vertex: {
                module,
                entryPoint: shader.vertexEntryPoint || DEFAULT_VERTEX_ENTRY_POINT,
            },
            fragment: {
                module,
                entryPoint: shader.fragmentEntryPoint || DEFAULT_FRAGMENT_ENTRY_POINT,
                targets: [{ format: this.format }],
            },
            primitive: { topology: 'triangle-list' },
        });
        this.label = shader.label;
        this.elapsed = 0;
        this.frameIndex = 0;
    }

    start() {
        if (this.animationFrame === null) {
            this.lastTimestamp = null;
            this.animationFrame = requestAnimationFrame(timestamp => this.renderFrame(timestamp));
        }
    }

    stop() {
        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    dispose() {
        this.stop();
        this.resizeObserver.disconnect();
        this.context.unconfigure();
        this.uniformBuffer.destroy();
        this.device.destroy();
    }

    private resizeCanvas() {
        const limit = this.device.limits.maxTextureDimension2D;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.min(limit, Math.max(1, Math.round(this.canvas.clientWidth * ratio)));
        const height = Math.min(limit, Math.max(1, Math.round(this.canvas.clientHeight * ratio)));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    private renderFrame(timestamp: number) {
        this.animationFrame = requestAnimationFrame(next => this.renderFrame(next));

        const delta = this.lastTimestamp === null
            ? 0
            : Math.min((timestamp - this.lastTimestamp) / 1000, MAX_FRAME_DELTA_SECONDS);
        this.lastTimestamp = timestamp;
        this.elapsed += delta;
        // Exponential smoothing, else the readout is not legible.
        if (delta > 0) {
            this.framePerSecond = this.framePerSecond === 0
                ? 1 / delta
                : this.framePerSecond * 0.9 + (1 / delta) * 0.1;
        }

        if (this.pipeline === null) {
            return;
        }

        this.uniforms.setFloat32(0, this.canvas.width, true);
        this.uniforms.setFloat32(4, this.canvas.height, true);
        this.uniforms.setFloat32(8, this.elapsed, true);
        this.uniforms.setFloat32(12, this.frameIndex, true);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);

        const encoder = this.device.createCommandEncoder({ label: 'frame' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3);
        pass.end();
        this.device.queue.submit([encoder.finish()]);

        this.frameIndex += 1;
        if (this.onStatistics && this.frameIndex % 10 === 0) {
            this.onStatistics({
                label: this.label,
                width: this.canvas.width,
                height: this.canvas.height,
                framePerSecond: this.framePerSecond,
            });
        }
    }
}

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Malformed renderer webview: element #${id} is missing.`);
    }
    return element as T;
}

async function main() {
    const canvas = requireElement<HTMLCanvasElement>('canvas');
    const status = requireElement('status');
    const error = requireElement('error');

    const reportError = (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        error.textContent = message;
        error.hidden = false;
        host.postMessage({ type: 'error', message });
    };

    let renderer: WebGpuRenderer;
    try {
        renderer = await WebGpuRenderer.create(canvas);
    } catch (reason) {
        reportError(reason);
        return;
    }

    renderer.setStatisticsListener(statistics => {
        status.textContent = `${statistics.label} | ${statistics.width}x${statistics.height} ` +
            `${renderer.getFormat()} | ${statistics.framePerSecond.toFixed(0)} fps`;
    });

    const setShader = async (shader: ShaderSource) => {
        try {
            await renderer.setShader(shader);
            error.hidden = true;
            error.textContent = '';
        } catch (reason) {
            reportError(reason);
        }
    };

    window.addEventListener('message', (event: MessageEvent) => {
        const message = event.data as HostMessage;
        switch (message.type) {
            case 'setShader':
                void setShader(message.shader);
                break;
            case 'setPaused':
                if (message.paused) {
                    renderer.stop();
                } else {
                    renderer.start();
                }
                break;
        }
    });
    window.addEventListener('unload', () => renderer.dispose());

    // Draw the built-in shader right away, the host overrides it if it has one.
    await setShader(DEFAULT_SHADER);
    renderer.start();
    host.postMessage({ type: 'ready' });
}

void main();
