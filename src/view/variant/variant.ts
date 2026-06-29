import * as vscode from 'vscode';
import { DocumentUri } from "vscode-languageclient";
import { resolveVSCodeVariables } from "../../client";
import path from "path";

// using vscode.Uri as key to Map does not work as it compare by ref and not value... So we can have duplicated keys...
// Using this wrapper to fix this by using underlying string as key.
export class UriMap<V> implements Iterable<[vscode.Uri, V]> {
    private readonly _map = new Map<string, { uri: vscode.Uri; value: V }>();

    constructor(iterable?: Iterable<readonly [vscode.Uri, V]> | null) {
        if (iterable) {
            for (const [uri, value] of iterable) {
                this.set(uri, value);
            }
        }
    }

    set(uri: vscode.Uri, value: V): this {
        this._map.set(uri.toString(), { uri, value });
        return this;
    }

    get(uri: vscode.Uri): V | undefined {
        return this._map.get(uri.toString())?.value;
    }

    has(uri: vscode.Uri): boolean {
        return this._map.has(uri.toString());
    }

    delete(uri: vscode.Uri): boolean {
        return this._map.delete(uri.toString());
    }

    get size(): number {
        return this._map.size;
    }

    [Symbol.iterator](): Iterator<[vscode.Uri, V]> {
        return this.entries();
    }

    forEach(callbackfn: (value: V, key: vscode.Uri, map: UriMap<V>) => void, thisArg?: any): void {
        for (const { uri, value } of this._map.values()) {
            callbackfn.call(thisArg, value, uri, this);
        }
    }

    *entries(): IterableIterator<[vscode.Uri, V]> {
        for (const { uri, value } of this._map.values()) {
            yield [uri, value];
        }
    }

    *values(): IterableIterator<V> {
        for (const { value } of this._map.values()) {
            yield value;
        }
    }
}

function resolveUserPath(inputPath: string): string | undefined {
    if (path.isAbsolute(inputPath)) {
        return path.normalize(inputPath).replace("\\", "/");
    }
    if (vscode.workspace.workspaceFolders) {
        for (let workspaceRoot of vscode.workspace.workspaceFolders) {
            // TODO: What if not found ? Check other workspaces ?
            return path.resolve(workspaceRoot.uri.fsPath, inputPath).replace("\\", "/");
        }
    } else {
        return undefined;
    }
    return undefined;
}

export function serializeShaderVariantNode(data: ShaderVariantNode): string {
    return JSON.stringify(data);
}
function deserializeShaderVariant(data: any, uri: vscode.Uri): ShaderVariant {
    if (typeof data !== 'object') {
        throw new SyntaxError(`variant ${data} is not an object`);
    }
    if (typeof data["name"] !== 'string') {
        throw new SyntaxError(`variant name ${data["name"]} is not an string`);
    }
    if (typeof data["stage"] !== 'string') {
        throw new SyntaxError(`variant stage ${data["stage"]} is not an string`);
    }
    if (typeof data["defines"] !== 'object') {
        throw new SyntaxError(`variant defines ${data["defines"]} is not an object`);
    }
    if (!Array.isArray(data["includes"])) {
        throw new SyntaxError(`variant include ${data["includes"]} is not an include`);
    }
    return {
        'kind': 'variant',
        'uri': uri,
        'name': data["name"] as string,
        'isActive': false,
        'stage': {
            'kind': 'stage',
            'stage': ShaderStage[data["stage"] as keyof typeof ShaderStage] 
        } as ShaderVariantStage,
        'defines': {
            kind: 'defineList',
            defines: Object.entries(data["defines"]).map(e => {
                if (typeof e[0] !== 'string') {
                    throw new SyntaxError(`variant define key ${e[0]} is not a string`);
                }
                if (typeof e[1] !== 'string') {
                    throw new SyntaxError(`variant define value ${e[1]} is not a string`);
                }
                return {
                    kind: 'define',
                    label: e[0] as string,
                    value: e[1] as string
                } as ShaderVariantDefine
            }),
        } as ShaderVariantDefineList,
        'includes': {
            kind: 'includeList',
            includes: data["includes"].map(e => {
                if (typeof e !== 'string') {
                    throw new SyntaxError(`variant include ${e} is not a string`);
                }
                return {
                    kind: 'include',
                    include: e as string,
                } as ShaderVariantInclude
            }),
        } as ShaderVariantIncludeList,
    } as ShaderVariant;
}
function deserializeShaderVariantFile(data: any): ShaderVariantFile {
    if (typeof data !== 'object') {
        throw new SyntaxError("variant is not an object");
    }
    if (typeof data["uri"] !== 'string') {
        throw new SyntaxError(`variant uri ${data["uri"]} is not a string`);
    }
    let uri = vscode.Uri.file(resolveUserPath(data["uri"]) || data["uri"]);
    return {
        'kind': 'file',
        'uri': uri,
        'variants': data["variants"].map((e: any) => deserializeShaderVariant(e, uri))
    } as ShaderVariantFile;
}
/**
 * Converts a JavaScript Object Notation (JSON) string into a ShaderVariantNode.
 * @param data A valid JSON string.
 * @throws {SyntaxError} If `data` is not valid JSON or incorrect format for database.
 */
export function deserializeShaderVariantNode(data: string): ShaderVariantFile[] {
    const json = JSON.parse(data);
    if (Array.isArray(json)) {
        return json.map(data => deserializeShaderVariantFile(data));
    } else {
        throw new SyntaxError("Incorrect database format: not an array");
    }
}


export type ShaderVariantDefine = {
    kind: 'define',
    label: string,
    value: string,
};

export type ShaderVariantDefineList = {
    kind: 'defineList',
    defines: ShaderVariantDefine[],
};

export type ShaderVariantInclude = {
    kind: 'include',
    include: string,
};

export type ShaderVariantIncludeList = {
    kind: 'includeList',
    includes: ShaderVariantInclude[],
};

export enum ShaderStage {
    auto,
    vertex,
    fragment,
    compute,
    tesselationControl,
    tesselationEvaluation,
    mesh,
    task,
    geometry,
    rayGeneration,
    closestHit,
    anyHit,
    callable,
    miss,
    intersect,
}

export type ShaderVariantStage = {
    kind: 'stage',
    stage: ShaderStage,
};

// This should be shadervariant.
export type ShaderVariant = {
    kind: 'variant';
    uri: vscode.Uri;
    name: string;
    isActive: boolean;
    // Per variant data
    stage: ShaderVariantStage;
    defines: ShaderVariantDefineList;
    includes: ShaderVariantIncludeList;
};

export type ShaderVariantFile = {
    kind: 'file',
    // These are currently generated at runtime, so can't get parents easily...
    //parent: ShaderVariantRoot | ShaderVariantDatabase,
    uri: vscode.Uri,
    variants: ShaderVariant[],
};
export type ShaderVariantRoot = {
    kind: 'root'
    label: string,
    files: ShaderVariantFile[],
};

export type ShaderVariantDatabase = {
    kind: 'database'
    uri: vscode.Uri,
    label: string,
    files: ShaderVariantFile[],
};

export type ShaderVariantNode = ShaderVariant | ShaderVariantFile | ShaderVariantDefineList | ShaderVariantIncludeList | ShaderVariantDefine | ShaderVariantInclude | ShaderVariantStage | ShaderVariantRoot | ShaderVariantDatabase;
