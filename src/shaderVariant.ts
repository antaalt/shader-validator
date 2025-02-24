import * as vscode from 'vscode';
import { CancellationToken, DocumentSymbol, DocumentSymbolRequest, LanguageClient, ProtocolNotificationType, ProtocolRequestType, Range, SymbolInformation, SymbolKind, TextDocumentIdentifier, TextDocumentItem, TextDocumentRegistrationOptions } from 'vscode-languageclient/node';

interface ShaderVariantSerialized {
    entryPoint: string,
    stage: string | null,
    defines: Object,
    includes: string[],
}

function shaderVariantToSerialized(e: ShaderVariant) : ShaderVariantSerialized {
    function cameltoPascalCase(s: string) : string {
        return String(s[0]).toUpperCase() + String(s).slice(1);
    }
    return {
        entryPoint: e.name,
        stage: (e.stage.stage === ShaderStage.auto) ? null : cameltoPascalCase(ShaderStage[e.stage.stage]),
        defines: Object.fromEntries(e.defines.defines.map(e => [e.label, e.value])),
        includes: e.includes.includes.map(e => e.include)
    };
}
function getActiveFileVariant(file: ShaderVariantFile) : ShaderVariant | null {
    return file.variants.find((e: ShaderVariant) => {
        return e.isActive;
    }) || null;
}
// Notification from client to change shader variant
interface DidChangeShaderVariantParams {
    textDocument: TextDocumentIdentifier
    shaderVariant: ShaderVariantSerialized | null
}
interface DidChangeShaderVariantRegistrationOptions extends TextDocumentRegistrationOptions {}

const didChangeShaderVariantNotification = new ProtocolNotificationType<DidChangeShaderVariantParams, DidChangeShaderVariantRegistrationOptions>('textDocument/didChangeShaderVariant');

// Request from server to send file active variant.
interface ShaderVariantParams extends TextDocumentIdentifier {}
interface ShaderVariantRegistrationOptions extends TextDocumentRegistrationOptions {}

interface ShaderVariantResponse {
    shaderVariant: ShaderVariantSerialized | null,
}
const shaderVariantRequest = new ProtocolRequestType<ShaderVariantParams, ShaderVariantResponse, never, void, ShaderVariantRegistrationOptions>('textDocument/shaderVariant');


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
    uri: vscode.Uri,
    variants: ShaderVariant[],
};

export type ShaderFunctionList = {
    entryPoint: string,
    range: vscode.Range,
};

export type ShaderVariantNode = ShaderVariant | ShaderVariantFile | ShaderVariantDefineList | ShaderVariantIncludeList | ShaderVariantDefine | ShaderVariantInclude | ShaderVariantStage;

const shaderVariantTreeKey : string = 'shader-validator.shader-variant-tree-key';

export class ShaderVariantTreeDataProvider implements vscode.TreeDataProvider<ShaderVariantNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderVariantNode | undefined | void> = new vscode.EventEmitter<ShaderVariantNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderVariantNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    // using vscode.Uri as key does not match well with Memento state storage...
    private files: Map<string, ShaderVariantFile>;
    private tree: vscode.TreeView<ShaderVariantNode>;
    private client: LanguageClient;
    private decorator: vscode.TextEditorDecorationType;
    private workspaceState: vscode.Memento;
    private shaderFunctionCache: Map<string, ShaderFunctionList[]>;

    private load() {
        let variants : ShaderVariantFile[] = this.workspaceState.get<ShaderVariantFile[]>(shaderVariantTreeKey, []);
        this.files = new Map(variants.map((e : ShaderVariantFile) => {
            // Seems that serialisation is breaking something, so this is required for uri & range to behave correctly.
            e.uri = vscode.Uri.from(e.uri);
            for (let variant of e.variants) {
                variant.uri = vscode.Uri.from(variant.uri);
            }
            return [e.uri.path, e];
        }));
    }
    private save() {
        let array = Array.from(this.files.values());
        this.workspaceState.update(shaderVariantTreeKey, array);
    }

    constructor(context: vscode.ExtensionContext, client: LanguageClient) {
        this.workspaceState = context.workspaceState;
        this.files = new Map;
        this.load();
        this.shaderFunctionCache = new Map;
        this.client = client;
        this.tree = vscode.window.createTreeView<ShaderVariantNode>("shader-validator-variants", {
            treeDataProvider: this
            // TODO: drag and drop for better ux.
            //dragAndDropController:
        });
        this.tree.onDidChangeCheckboxState((e: vscode.TreeCheckboxChangeEvent<ShaderVariantNode>) => {
            for (let [variant, checkboxState] of e.items) {
                if (variant.kind === 'variant') {
                    if (checkboxState === vscode.TreeItemCheckboxState.Checked) {
                        // Need to unset other possibles active ones to keep only one entry point active per file.
                        let file = this.files.get(variant.uri.path);
                        if (file) {
                            let needRefresh = false;
                            for (let otherVariant of file.variants) {
                                if (otherVariant.isActive) {
                                    needRefresh = true;
                                    otherVariant.isActive = false;
                                }
                            }
                            variant.isActive = true; // checked
                            if (needRefresh) {
                                // Refresh file & all its childs
                                this.refresh(file, file);
                            } else {
                                this.refresh(variant, file);
                            }
                        } else {
                            console.warn("Failed to find file ", variant.uri);
                            variant.isActive = true; // checked
                        }
                    } else {
                        variant.isActive = false; // unchecked
                        let file = this.files.get(variant.uri.path);
                        if (file) {
                            this.refresh(file, file);
                        }
                    }
                }
            }
            this.updateDecorations();
        });
        this.decorator = vscode.window.createTextEditorDecorationType({
            // Icon
            gutterIconPath: context.asAbsolutePath('./res/icons/hlsl-icon.svg'),
            gutterIconSize: "contain",
            // Minimap
            overviewRulerColor: "rgb(0, 174, 255)",  
            overviewRulerLane: vscode.OverviewRulerLane.Full,  
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            // Border
            borderWidth: '1px',
            borderStyle: 'solid',
        });
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addCurrentFile", (node: any): void => {
            // undefined means called from title.
            console.log("adding", node);
            let supportedLangId = ["hlsl", "glsl", "wgsl"];
            if (vscode.window.activeTextEditor && supportedLangId.includes(vscode.window.activeTextEditor.document.languageId)) {
                this.open(vscode.window.activeTextEditor.document.uri);
            }
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addMenu", (node: ShaderVariantNode): void => {
            this.add(node);
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", (node: ShaderVariantNode) => {
            this.delete(node);
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            await this.edit(node);
            this.save();
        }));
        // Prepare entry point symbol cache
        for (let editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.shaderFunctionCache.set(editor.document.uri.path, []);
            }
        }
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.scheme === 'file') {
                this.shaderFunctionCache.set(document.uri.path, []);
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
            this.shaderFunctionCache.delete(document.uri.path);
        }));
        this.updateDependencies();
    }

    private getFileAndParentNode(node: ShaderVariantNode) : [ShaderVariantFile, ShaderVariantNode | null] | null {
        if (node.kind === 'variant') {
            let file = this.files.get(node.uri.path);
            if (file) {
                return [file, null]; // No parent
            }
        } else if (node.kind === 'define') {
            for (let [_, file] of this.files) {
                for (let variant of file.variants) {
                    let index = variant.defines.defines.indexOf(node);
                    if (index > -1) {
                        return [file, variant.defines];
                    }
                }
            }
        } else if (node.kind === 'defineList') {
            for (let [_, file] of this.files) {
                for (let variant of file.variants) {
                    if (variant.defines === node) {
                        return [file, variant];
                    }
                }
            }
        } else if (node.kind === 'stage') {
            for (let [_, file] of this.files) {
                for (let variant of file.variants) {
                    if (variant.stage === node) {
                        return [file, variant];
                    }
                }
            }
        } else if (node.kind === 'include') {
            for (let [_, file] of this.files) {
                for (let variant of file.variants) {
                    let index = variant.includes.includes.indexOf(node);
                    if (index > -1) {
                        return [file, variant.includes];
                    }
                }
            }
        } else if (node.kind === 'includeList') {
            for (let [_, file] of this.files) {
                for (let variant of file.variants) {
                    if (variant.includes === node) {
                        return [file, variant];
                    }
                }
            }
        }
        console.warn("Failed to find file for node ", node);
        return null;
    }

    public refresh(node: ShaderVariantNode, file: ShaderVariantFile | null, updateFileNode?: boolean) {
        this.onDidChangeTreeDataEmitter.fire();
        if (file) {
            this.updateDependency(file);
        } else {
            let result = this.getFileAndParentNode(node);
            if (result) {
                let [file, parent] = result;
                this.updateDependency(file);
            } else {
                // Something failed here...
                this.updateDependencies();
            }
        }
    }
    public refreshAll() {
        this.onDidChangeTreeDataEmitter.fire();
        this.updateDependencies();
    }
    private updateDependency(file: ShaderVariantFile) {
        let fileActiveVariant = getActiveFileVariant(file);
        let params : DidChangeShaderVariantParams = {
            textDocument: {
                uri: this.client.code2ProtocolConverter.asUri(file.uri),
            },
            shaderVariant: fileActiveVariant ? shaderVariantToSerialized(fileActiveVariant) : null,
        };
        this.client.sendNotification(didChangeShaderVariantNotification, params);

        // Symbols might have changed, so request them as we use this to compute symbols.
        // TODO: update vscode symbols for gutter to show.
        // This one seems to get symbol from cache without requesting the server...
        //vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", file.uri);
        // This one works, but result is not intercepted by vscode & updated...
        //this.client.sendRequest(DocumentSymbolRequest.type, {
        //    textDocument: {
        //        uri: this.client.code2ProtocolConverter.asUri(file.uri),
        //    }
        //});
    }
    public onDocumentSymbols(uri: vscode.Uri, symbols: vscode.SymbolInformation[]) {
        let shaderFunctionCache = this.shaderFunctionCache.get(uri.path);
        if (shaderFunctionCache) {
            let shaderFunctionList = symbols.filter(symbol => symbol.kind === vscode.SymbolKind.Function);
            shaderFunctionCache = [];
            for (let symbol of shaderFunctionList) {
                shaderFunctionCache.push({
                    entryPoint: symbol.name, 
                    range: new vscode.Range(
                        new vscode.Position(symbol.location.range.start.line, symbol.location.range.start.character), 
                        new vscode.Position(symbol.location.range.end.line, symbol.location.range.end.character)
                    )
                });
            }
            this.shaderFunctionCache.set(uri.path, shaderFunctionCache);
            this.updateDecorations();
        }
    }
    private updateDependencies() {
        for (let [_, file] of this.files) {
            this.updateDependency(file);
        }
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
            item.checkboxState = element.isActive ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'file') {
            let item = new vscode.TreeItem(vscode.workspace.asRelativePath(element.uri.path), vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.variants.length}`;
            item.resourceUri = element.uri;
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
            item.iconPath = new vscode.ThemeIcon('files');
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
            item.iconPath = new vscode.ThemeIcon('code');
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
                console.error("Reached unreachable", element);
                return undefined!; // unreachable
            }
        } else {
            // Convert to array
            return Array.from(this.files.values());
        }
    }

    public open(uri: vscode.Uri): void {
        if (uri.scheme !== 'file') {
            return;
        }
        let file = this.files.get(uri.path);
        if (!file) {
            let newFile : ShaderVariantFile = {
                kind: 'file',
                uri: uri,
                variants: []
            };
            this.files.set(uri.path, newFile);
            this.refreshAll();
        }
    }
    public close(uri: vscode.Uri): void {
        let file = this.files.get(uri.path);
        if (file) {
            // We keep it if some variants where defied.
            if (file.variants.length === 0) {
                this.files.delete(uri.path);
                this.refreshAll();
            }
        }
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
                },
            });
            this.refresh(node, node);
        } else if (node.kind === 'defineList') {
            node.defines.push({
                kind: "define",
                label: "MY_MACRO",
                value: "0",
            });
            this.refresh(node, null);
        } else if (node.kind === 'includeList') {
            node.includes.push({
                kind: "include",
                include: "C:/",
            });
            this.refresh(node, null);
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
                this.refresh(node, null);
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
                this.refresh(node, null);
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
                this.refresh(node, null);
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
                this.refresh(node, null);
            }
        }
    }
    public delete(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            this.files.delete(node.uri.path);
            this.refreshAll();
        } else if (node.kind === 'variant') {
            let cachedFile = this.files.get(node.uri.path);
            if (cachedFile) {
                let index = cachedFile.variants.indexOf(node);
                if (index > -1) {
                    cachedFile.variants.splice(index, 1);
                    this.refresh(cachedFile, cachedFile);
                }
            }
        } else if (node.kind === 'define') {
            // Dirty remove, might be costly when lot of elements...
            for (let [_, file] of this.files) {
                let found = false;
                for (let variant of file.variants) {
                    let index = variant.defines.defines.indexOf(node);
                    if (index > -1) {
                        variant.defines.defines.splice(index, 1);
                        // Refresh variant for description
                        this.refresh(variant, file);
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
                        variant.includes.includes.splice(index, 1);
                        this.refresh(variant.includes, file);
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
    private updateDecoration(editor: vscode.TextEditor) {
        let file = this.files.get(editor.document.uri.path);
        let entryPoints = this.shaderFunctionCache.get(editor.document.uri.path);

        if (file && entryPoints) {
            let variant = getActiveFileVariant(file);
            if (variant) {
                let found = false;
                for (let entryPoint of entryPoints) {
                    if (entryPoint.entryPoint === variant.name) {
                        let decorations : vscode.DecorationOptions[]= [];
                        decorations.push({ range: entryPoint.range, hoverMessage: variant.name });
                        editor.setDecorations(this.decorator, decorations);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.info("Entry point not found in ", entryPoints);
                    editor.setDecorations(this.decorator, []);
                }
            } else {
                console.info("No active variant ", entryPoints);
                editor.setDecorations(this.decorator, []);
            }
        } else {
            console.info("No file or entry point ", file, entryPoints);
            editor.setDecorations(this.decorator, []);
        }
    }
    private updateDecorations(uri?: vscode.Uri) {
        for (let editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.updateDecoration(editor);
            }
        }
    }
}