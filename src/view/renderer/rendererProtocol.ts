import { NotificationType, RequestType, RequestType0 } from 'vscode-jsonrpc';

import { CompilationType, CompileShaderResult, decodeCompileShaderData } from '../../request';
import { ShaderStage } from '../variant/variant';

/// All types here mirror the serde representation of the shader-renderer types.
/// Rust enums are externally tagged and structs use their raw snake_case field names,
/// so any rename on the server side must be mirrored here.

export interface RendererShader {
    shadingLanguage: string,
    stage: string,
    entryPoint: string,
    filePath: string,
    content: string,
    defines: Object,
    includes: string[],
}

export interface ResizeTargetParams {
    width: number,
    height: number,
}

export interface UpdateShaderParams {
    shaderStage: string,
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
export const errorNotification = new NotificationType<ErrorParams>('server/error');

// Both requests take a unit as params on the renderer side, so send them without any.
export const renderRequest = new RequestType0<RenderResult, void>('renderer/render');
export const updateShaderRequest = new RequestType<UpdateShaderParams, void, void>('renderer/updateShader');
export const shutdownRequest = new RequestType0<null, void>('shutdown');

/// Format of the texture read back by the renderer. Must match Renderer::SURFACE_FORMAT.
export const rendererSurfaceBytesPerTexel = 4;

/// wgpu requires every row of a texture to buffer copy to be aligned on this value.
const copyBytesPerRowAlignment = 256;

export function alignBytesPerRow(width: number): number {
    const bytesPerRow = width * rendererSurfaceBytesPerTexel;
    return Math.ceil(bytesPerRow / copyBytesPerRowAlignment) * copyBytesPerRowAlignment;
}
