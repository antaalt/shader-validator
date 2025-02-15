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
            item.description = `[${element.defines.defines.map(d => d.label).join(",")}]`;
            item.tooltip = `Shader variant ${element.name}`;
            item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
            item.iconPath = new vscode.ThemeIcon('code');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'file') {
            let item = new vscode.TreeItem(vscode.workspace.asRelativePath(element.uri.path), vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.variants.length}`;
            item.tooltip = `File ${element.uri.fsPath}`;
            item.iconPath = vscode.ThemeIcon.File;
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'defineList') {
            let item = new vscode.TreeItem("defines", vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.defines.length}`;
            item.iconPath = new vscode.ThemeIcon('keyboard');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'includeList') {
            let item = new vscode.TreeItem("includes", vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.includes.length}`;
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
                return [element.stage, element.defines, element.includes];
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

    // TODO: instead of addFile, should have all workspace file in tree ?
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
    public add(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            node.variants.push({
                kind: 'variant',
                uri: node.uri,
                name: 'main',
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
            });
            this.refresh();
        } else if (node.kind === 'defineList') {
            node.defines.push({
                kind: "define",
                label: "MY_MACRO",
                value: "0",
            });
            this.refresh();
        } else if (node.kind === 'includeList') {
            node.includes.push({
                kind: "include",
                include: "C:/",
            });
            this.refresh();
        }
    }
    public async edit(node: ShaderVariantNode) {
        if (node.kind === 'variant') {
            let name = await vscode.window.showInputBox({
                title: "Entry point selection",
                value: node.name,
                prompt: "Select an entry point name for your variant",
                placeHolder: "main"
            });
            if (name) {
                node.name = name;
                this.refresh();
            }
        } else if (node.kind === 'define') {
            let label = await vscode.window.showInputBox({
                title: "Macro label",
                value: node.label,
                prompt: "Select a label for you macro.",
                placeHolder: "MY_MACRO"
            });
            let value = await vscode.window.showInputBox({
                title: "Macro value",
                value: node.value,
                prompt: "Select a value for you macro.",
                placeHolder: "0"
            });
            if (label) {
                node.label = label;
            }
            if (value) {
                node.value = value;
            }
            if (value || label) {
                this.refresh();
            }
        } else if (node.kind === 'include') {
            let include = await vscode.window.showInputBox({
                title: "Include path",
                value: node.include,
                prompt: "Select a path for your include.",
                placeHolder: "C:/Users/"
            });
            if (include) {
                node.include = include;
                this.refresh();
            }
        } else if (node.kind === 'stage') {
            let stage = await vscode.window.showQuickPick(
                [
                    ShaderStage[ShaderStage.auto],
                    ShaderStage[ShaderStage.vertex],
                    ShaderStage[ShaderStage.fragment],
                    ShaderStage[ShaderStage.compute],
                    ShaderStage[ShaderStage.tesselationControl],
                    ShaderStage[ShaderStage.tesselationEvaluation],
                    ShaderStage[ShaderStage.mesh],
                    ShaderStage[ShaderStage.task],
                    ShaderStage[ShaderStage.geometry],
                    ShaderStage[ShaderStage.rayGeneration],
                    ShaderStage[ShaderStage.closestHit],
                    ShaderStage[ShaderStage.anyHit],
                    ShaderStage[ShaderStage.callable],
                    ShaderStage[ShaderStage.miss],
                    ShaderStage[ShaderStage.intersect],
                ],
                {
                    title: "Shader stage"
                }
            );
            if (stage) {
                node.stage = ShaderStage[stage as keyof typeof ShaderStage];
                this.refresh();
            }
        }
    }
    public delete(node: ShaderVariantNode) {
        if (node.kind === 'variant') {
            let cachedFile = this.files.get(node.uri);
            if (cachedFile) {
                let index = cachedFile.variants.indexOf(node);
                if (index > -1) {
                    delete cachedFile.variants[index];
                    this.refresh();
                }
            }
        } else if (node.kind === 'define') {
            // Dirty remove, might be costly when lot of elements...
            for (let [uri, file] of this.files) {
                let found = false;
                for (let variant of file.variants) {
                    let index = variant.defines.defines.indexOf(node);
                    if (index > -1) {
                        delete variant.defines.defines[index];
                        this.refresh();
                        found = true;
                        break;
                    }
                }
                if (found) {
                    break;
                }
            }
        } else if (node.kind === 'include') {
            // Dirty remove, might be costly when lot of elements...
            for (let [uri, file] of this.files) {
                let found = false;
                for (let variant of file.variants) {
                    let index = variant.includes.includes.indexOf(node);
                    if (index > -1) {
                        delete variant.includes.includes[index];
                        this.refresh();
                        found = true;
                        break;
                    }
                }
                if (found) {
                    break;
                }
            }
        }
    }
    public visitShaderVariants(uri: vscode.Uri, callback: (variant: ShaderVariant) => void) {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === 'file') {
                for (let variant of cachedFile.variants) {
                    callback(variant);
                }
            }
        }
    }
}