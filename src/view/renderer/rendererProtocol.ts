import { NotificationType, RequestType0 } from 'vscode-jsonrpc';

import { CompilationType, CompileShaderResult, decodeCompileShaderData } from '../../request';
import { ShaderStage } from '../variant/variant';

/// All types here mirror the serde representation of the shader-renderer types.
/// Rust enums are externally tagged and structs use their raw snake_case field names,
/// so any rename on the server side must be mirrored here.

export type RendererShadingLanguage = 'Wgsl' | 'Hlsl' | 'Glsl';

/// ShaderStage is serialized as camelCase, unlike ShadingLanguage which keeps its variant names.
export type RendererShaderStage =
    'vertex' |
    'fragment' |
    'compute' |
    'tesselationControl' |
    'tesselationEvaluation' |
    'mesh' |
    'task' |
    'geometry' |
    'rayGeneration' |
    'closestHit' |
    'anyHit' |
    'callable' |
    'miss' |
    'intersect';

/// Externally tagged enum ShaderSource. Spirv is a Vec<u32> & Dxil a Vec<u8>, both
/// serialized as plain number arrays, while Wgsl & Glsl are sent as source code.
export type RendererShaderSource =
    { 'Spirv': number[] } |
    { 'Dxil': number[] } |
    { 'Wgsl': string } |
    { 'Glsl': string };

export interface RendererShader {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    shading_language: RendererShadingLanguage,
    stage: RendererShaderStage,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    entry_point: string,
    source: RendererShaderSource,
}

export interface ResizeTargetParams {
    width: number,
    height: number,
}

export interface UpdateShaderParams {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    shader_stage: RendererShaderStage,
    /// Null unsets the shader currently bound to this stage.
    shader: RendererShader | null,
}

export interface RenderResult {
    /// Renderer sends a Vec<u8> of raw Rgba8Unorm texels, which serde serializes as a base64 string.
    data: string,
}

export interface ErrorParams {
    message: string,
}

export const resizeTargetNotification = new NotificationType<ResizeTargetParams>('renderer/resize');
export const updateShaderNotification = new NotificationType<UpdateShaderParams>('renderer/updateShader');
export const errorNotification = new NotificationType<ErrorParams>('server/error');

// Both requests take a unit as params on the renderer side, so send them without any.
export const renderRequest = new RequestType0<RenderResult, void>('renderer/render');
export const shutdownRequest = new RequestType0<null, void>('shutdown');

/// Format of the texture read back by the renderer. Must match Renderer::SURFACE_FORMAT.
export const rendererSurfaceBytesPerTexel = 4;

/// wgpu requires every row of a texture to buffer copy to be aligned on this value.
const copyBytesPerRowAlignment = 256;

export function alignBytesPerRow(width: number): number {
    const bytesPerRow = width * rendererSurfaceBytesPerTexel;
    return Math.ceil(bytesPerRow / copyBytesPerRowAlignment) * copyBytesPerRowAlignment;
}

export function toRendererShadingLanguage(languageId: string): RendererShadingLanguage | null {
    switch (languageId) {
        case 'hlsl': return 'Hlsl';
        case 'glsl': return 'Glsl';
        case 'wgsl': return 'Wgsl';
        default: return null;
    }
}

/// Convert a variant stage to a renderer stage. Returns null for ShaderStage.auto,
/// which the renderer cannot map to a pipeline slot.
export function toRendererShaderStage(stage: ShaderStage): RendererShaderStage | null {
    switch (stage) {
        case ShaderStage.vertex: return 'vertex';
        case ShaderStage.fragment: return 'fragment';
        case ShaderStage.compute: return 'compute';
        case ShaderStage.tesselationControl: return 'tesselationControl';
        case ShaderStage.tesselationEvaluation: return 'tesselationEvaluation';
        case ShaderStage.mesh: return 'mesh';
        case ShaderStage.task: return 'task';
        case ShaderStage.geometry: return 'geometry';
        case ShaderStage.rayGeneration: return 'rayGeneration';
        case ShaderStage.closestHit: return 'closestHit';
        case ShaderStage.anyHit: return 'anyHit';
        case ShaderStage.callable: return 'callable';
        case ShaderStage.miss: return 'miss';
        case ShaderStage.intersect: return 'intersect';
        case ShaderStage.auto: return null;
        default: return null;
    }
}

/// Convert a compilation result from the language server into a shader source the renderer accepts.
export function toRendererShaderSource(result: CompileShaderResult): RendererShaderSource {
    const bytes = decodeCompileShaderData(result.data);
    switch (result.compilationType) {
        case CompilationType.Spirv: {
            if (bytes.length % 4 !== 0) {
                throw new Error(`SPIRV payload of ${bytes.length} bytes is not a multiple of 4.`);
            }
            // SPIRV is consumed as words. Endianness is the host one on both sides.
            const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
            return { 'Spirv': Array.from(words) };
        }
        case CompilationType.Dxil:
            return { 'Dxil': Array.from(bytes) };
        case CompilationType.Wgsl:
            return { 'Wgsl': new TextDecoder('utf-8').decode(bytes) };
        default:
            throw new Error(`Unsupported compilation type for renderer: ${result.compilationType}`);
    }
}
