import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

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
    kind: 'variant',
    uri: vscode.Uri,
    name: string,
    isActive: boolean,
    // Per variant data
    stage: ShaderVariantStage,
    defines: ShaderVariantDefineList,
    includes: ShaderVariantIncludeList,
};

export type ShaderVariantFile = {
    kind: 'file',
    uri: vscode.Uri,
    variants: ShaderVariant[],
};

export type ShaderVariantNode = ShaderVariant | ShaderVariantFile | ShaderVariantDefineList | ShaderVariantIncludeList | ShaderVariantDefine | ShaderVariantInclude | ShaderVariantStage;

export class ShaderVariantTreeDataProvider implements vscode.TreeDataProvider<ShaderVariantNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderVariantNode | undefined | void> = new vscode.EventEmitter<ShaderVariantNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderVariantNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private files: Map<vscode.Uri, ShaderVariantFile> = new Map;

    public refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: ShaderVariantNode): vscode.TreeItem {
        if (element.kind === 'variant') {
            let item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.command = {
                title: "Go to variant",
                command: 'vscode.open',
                arguments: [
                    element.uri,
                    <vscode.TextDocumentShowOptions>{
                        selection: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))
                    }
                ]
            };
            item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
            item.iconPath = new vscode.ThemeIcon('code');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'file') {
            let item = new vscode.TreeItem(element.uri.fsPath, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = vscode.ThemeIcon.File;
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'defineList') {
            let item = new vscode.TreeItem("defines", vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('keyboard');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'includeList') {
            let item = new vscode.TreeItem("includes", vscode.TreeItemCollapsibleState.Expanded);
            item.tooltip = `User defined include ${element.includes}`,
            item.iconPath = new vscode.ThemeIcon('file-code');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'define') {
            let item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.description = element.value;
            item.tooltip = `User defined macro ${element.label} with value ${element.value}`,
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'include') {
            let item = new vscode.TreeItem(element.include, vscode.TreeItemCollapsibleState.None);
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'stage') {
            let item = new vscode.TreeItem("stage", vscode.TreeItemCollapsibleState.None);
            item.description = ShaderStage[element.stage];
            item.contextValue = element.kind;
            return item;
        } else {
            console.error("Unimplemented kind: ", element);
            return undefined!; // unreachable
        }
    }

    public getChildren(element?: ShaderVariantNode): ShaderVariantNode[] | Thenable<ShaderVariantNode[]> {
        if (element) {
            if (element.kind === 'variant') {
                return [element.stage, element.includes, element.defines];
            } else if (element.kind === 'file') {
                return element.variants;
            } else if (element.kind === 'includeList') {
                return element.includes;
            } else if (element.kind === 'defineList') {
                return element.defines;
            } else if (element.kind === 'include') {
                return [];
            } else if (element.kind === 'define') {
                return [];
            } else if (element.kind === 'stage') {
                return [];
            } else {
                return undefined!; // unreachable
            }
        } else {
            // Convert to array
            return Array.from(this.files.values());
        }
    }

    public addShaderVariant(uri: vscode.Uri, name: string): void {
        let cachedFile = this.files.get(uri);
        let newShaderVariant : ShaderVariant = {
            kind: 'variant',
            uri: uri,
            name: name,
            isActive: false,
            stage: {
                kind: 'stage',
                stage: ShaderStage.auto
            },
            defines: {
                kind: 'defineList',
                defines:[]
            },
            includes: {
                kind: 'includeList',
                includes:[]
            }
        };
        if (cachedFile) {
            cachedFile.variants.push(newShaderVariant);
        } else {
            let newFile : ShaderVariantFile = {
                kind: 'file',
                uri: uri,
                variants: [newShaderVariant]
            };
            this.files.set(uri, newFile);
        }
        this.refresh();
    }
    public deleteShaderVariant(entryPoint: ShaderVariant): void {
        let cachedFile = this.files.get(entryPoint.uri);
        if (cachedFile) {
            let index = cachedFile.variants.indexOf(entryPoint);
            if (index > -1) {
                delete cachedFile.variants[index];
            }
        }
        this.refresh();
    }

    public clearShaderVariant(uri: vscode.Uri): void {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === "file") {
                cachedFile.variants = [];
                this.refresh();
            } else {
                // unreachable
            }
        } else {
            console.warn("No cached file ", uri);
        }
    }
    public addFile(uri: vscode.Uri): void {
        let newFile : ShaderVariantFile = {
            kind: 'file',
            uri: uri,
            variants: []
        };
        this.files.set(uri, newFile);
        this.refresh();
    }
    public deleteFile(uri: vscode.Uri): void {
        this.files.delete(uri);
        this.refresh();
    }
    public visitShaderVariants(uri: vscode.Uri, callback: (e:string, active: boolean) => void) {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === 'file') {
                for (let file of cachedFile.variants) {
                    callback(file.name, file.isActive);
                }
            }
        }
    }
}