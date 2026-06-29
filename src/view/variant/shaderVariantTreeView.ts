import * as vscode from 'vscode';
import { CancellationToken, DocumentSymbol, DocumentSymbolRequest, DocumentUri, LanguageClient, ProtocolNotificationType, ProtocolRequestType, Range, SymbolInformation, SymbolKind, TextDocumentIdentifier, TextDocumentItem, TextDocumentRegistrationOptions } from 'vscode-languageclient/node';
import { resolveVSCodeVariables, ShaderLanguageClient } from '../../client';
import path from 'path';
import { deserializeShaderVariantNode, ShaderEntryPoint, ShaderStage, ShaderVariant, ShaderVariantDatabase, ShaderVariantFile, ShaderVariantNode, ShaderVariantRoot, UriMap } from './variant';
import { ShaderVariantNotifier } from './shaderVariantNotifier';

const shaderVariantTreeKey : string = 'shader-validator.shader-variant-tree-key';

export class ShaderVariantTreeDataProvider implements vscode.TreeDataProvider<ShaderVariantNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderVariantNode | undefined | void> = new vscode.EventEmitter<ShaderVariantNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderVariantNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private notifier: ShaderVariantNotifier;
    private files: UriMap<ShaderVariantFile>;
    private database: UriMap<Map<vscode.Uri, ShaderVariantFile>>;

    // Serialization & Editor
    private tree: vscode.TreeView<ShaderVariantNode>;
    private workspaceState: vscode.Memento;

    private load() {
        let variants : ShaderVariantFile[] = this.workspaceState.get<ShaderVariantFile[]>(shaderVariantTreeKey, []);
        this.files = new UriMap(variants.map((e : ShaderVariantFile) => {
            // Seems that serialisation is breaking something, so this is required for uri & range to behave correctly.
            e.uri = vscode.Uri.from(e.uri);
            for (let variant of e.variants) {
                variant.uri = vscode.Uri.from(variant.uri);
            }
            return [e.uri, e];
        }));
    }
    private save() {
        // TODO:CONFIG: save files opened as database.
        let array = Array.from(this.files.values());
        this.workspaceState.update(shaderVariantTreeKey, array);
    }

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.workspaceState = context.workspaceState;
        this.files = new UriMap;
        this.database = new UriMap;
        this.notifier = new ShaderVariantNotifier(context, server, this.files);
        this.load();
        this.tree = vscode.window.createTreeView<ShaderVariantNode>("shader-validator-variants", {
            treeDataProvider: this
            // TODO: drag and drop for better ux.
            //dragAndDropController:
        });
        this.tree.onDidChangeCheckboxState((e: vscode.TreeCheckboxChangeEvent<ShaderVariantNode>) => {
            for (let [variant, checkboxState] of e.items) {
                if (variant.kind === 'variant') {
                    if (checkboxState === vscode.TreeItemCheckboxState.Checked) {
                        // Need to unset other possibles active ones to keep only one entry point active.
                        for (let [url, file] of this.files) {
                            let needRefresh = false;
                            for (let otherVariant of file.variants) {
                                if (otherVariant.isActive) {
                                    needRefresh = true;
                                    otherVariant.isActive = false;
                                }
                            }
                            if (needRefresh) {
                                // Refresh file & all its childs
                                this.refresh(file, file);
                            } else {
                                this.refresh(variant, file);
                            }
                        }
                        variant.isActive = true; // checked
                    } else {
                        variant.isActive = false; // unchecked
                        let file = this.files.get(variant.uri);
                        if (file) {
                            this.refresh(file, file);
                        }
                    }
                }
            }
            this.notifier.notifyVariantChanged();
            this.save();
            this.notifier.updateDecorations();
        });
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.loadVariantDatabase", async () => {
            let fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                title: 'Load Variant Database',
                openLabel: 'Load',
                filters: {
                    'json': ['json']
                }
            });
            if (fileUris) {
                for (let fileUri of fileUris) {
                    this.loadDatabase(fileUri);
                }
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addCurrentFile", (): void => {
            if (vscode.window.activeTextEditor && ShaderLanguageClient.isEnabledLangId(vscode.window.activeTextEditor.document.languageId)) {
                this.open(vscode.window.activeTextEditor.document.uri);
            }
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addCurrentFileVariant", async () => {
            if (vscode.window.activeTextEditor && ShaderLanguageClient.isEnabledLangId(vscode.window.activeTextEditor.document.languageId)) {
                let entryPoint = await this.promptEntryPoint();
                if (entryPoint) {
                    let stage = await this.promptShaderStage();
                    if (stage) {
                        let uri = vscode.window.activeTextEditor.document.uri;
                        this.openOrAddVariant(uri, {
                            kind: 'variant',
                            uri: uri,
                            name: entryPoint,
                            isActive: true,
                            stage: {
                                kind: 'stage',
                                stage: stage
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
                    }
                }
            }
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addMenu", async (node: ShaderVariantNode) => {
            await this.add(node);
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", async (node: ShaderVariantNode) => {
            await this.delete(node);
            this.save();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.refreshMenu", (node: ShaderVariantNode) => {
            if (node.kind === 'database') {
                this.loadDatabase(node.uri);
                this.refreshAll();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            await this.edit(node);
            this.save();
        }));
        this.onServerStart();
    }
    onServerStart() {
        this.notifier.updateAllVariantAndSymbols();
    }
    dispose() {
        // Nothing to do here.
    }
    private async loadDatabase(fileUri: vscode.Uri) {
        // TODO:CONFIG: vscode.workspace.createFileSystemWatcher
        // TODO:CONFIG: what if invalid file ?
        const file = await vscode.workspace.fs.readFile(fileUri);
        try {
            const database = deserializeShaderVariantNode(file.toString());
            let databaseMap = new Map(database.map((e : ShaderVariantFile) => {
                return [e.uri, e];
            }));
            this.database.set(fileUri, databaseMap);
            this.onDidChangeTreeDataEmitter.fire();
        } catch (e) {
            let error = e as SyntaxError;
            vscode.window.showErrorMessage(`Failed to load variant database ${vscode.workspace.asRelativePath(fileUri)}: ${error.message}`);
        }
    }

    private getFileAndParentNode(node: ShaderVariantNode) : [ShaderVariantFile, ShaderVariantNode | null] | null {
        if (node.kind === 'variant') {
            // TODO:CONFIG: this does not look at the right place...
            let file = this.files.get(node.uri);
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
        } else {
            console.error("Node kind not implemented", node);
        }
        console.warn("Failed to find file for node ", node);
        return null;
    }

    public refresh(node: ShaderVariantNode | null, file: ShaderVariantFile | null) {
        this.onDidChangeTreeDataEmitter.fire();
        if (file) {
            this.notifier.updateVariantAndSymbols(file);
        } else if (node) {
            let result = this.getFileAndParentNode(node);
            if (result) {
                let [file, parent] = result;
                this.notifier.updateVariantAndSymbols(file);
            } else {
                // Something failed here...
                this.notifier.updateAllVariantAndSymbols();
            }
        }
    }
    public refreshAll() {
        this.onDidChangeTreeDataEmitter.fire();
        this.notifier.updateAllVariantAndSymbols();
    }

    public getTreeItem(element: ShaderVariantNode): vscode.TreeItem {
        if (element.kind === 'variant') {
            let item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
            // Need to use a middleware command because item is not updated on collapse change.
            item.command = {
                title: "Go to variant",
                command: 'shader-validator.gotoShaderEntryPoint',
                arguments: [
                    element.uri,
                    element.name
                ]
            };
            item.description = `[${element.defines.defines.map(d => d.label).join(",")}]`;
            item.tooltip = `Shader variant ${element.name}`;
            item.checkboxState = element.isActive ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'file') {
            let item = new vscode.TreeItem(vscode.workspace.asRelativePath(element.uri), vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.variants.length}`;
            item.resourceUri = element.uri;
            item.tooltip = `File ${element.uri.fsPath}`;
            item.iconPath = vscode.ThemeIcon.File;
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'defineList') {
            let item = new vscode.TreeItem("defines", vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.defines.length}`;
            item.tooltip = `List of defines`,
            item.iconPath = new vscode.ThemeIcon('keyboard');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'includeList') {
            let item = new vscode.TreeItem("includes", vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.includes.length}`;
            item.tooltip = `List of includes`,
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
            let resolvedIncludePath = resolveVSCodeVariables(element.include);
            let item = new vscode.TreeItem(element.include, vscode.TreeItemCollapsibleState.None);
            item.description = resolvedIncludePath;
            item.tooltip = `User include path ${resolvedIncludePath}`,
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'stage') {
            let item = new vscode.TreeItem("stage", vscode.TreeItemCollapsibleState.None);
            item.description = ShaderStage[element.stage];
            item.tooltip = "The shader stage of this variant. If auto is selected, the server will try to guess the stage, or use generic one when supported by API.";
            item.iconPath = new vscode.ThemeIcon('code');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'root') {
            let item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.tooltip = 'All variants defined.';
            item.iconPath = new vscode.ThemeIcon('list-tree');
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'database') {
            let item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.tooltip = `All variants parsed from config file ${element.uri.path} .`;
            item.iconPath = vscode.ThemeIcon.File;
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
            } else if (element.kind === 'root') {
                return element.files;
            } else if (element.kind === 'database') {
                return element.files;
            } else {
                console.error("Reached unreachable", element);
                return undefined!; // unreachable
            }
        } else {
            let rootArray : ShaderVariantNode[] = [];
            this.database.forEach((database, databaseUri) => {
                rootArray.push({
                    kind: 'database',
                    uri: databaseUri,
                    label: vscode.workspace.asRelativePath(databaseUri),
                    files: Array.from(database.values())
                } as ShaderVariantDatabase);
            });
            rootArray.push({
                kind: 'root',
                label: 'Main',
                files: Array.from(this.files.values())
            } as ShaderVariantRoot);
            return rootArray;
        }
    }

    public open(uri: vscode.Uri): void {
        this.openOrAddVariant(uri, null);
    }
    public openOrAddVariant(uri: vscode.Uri, variant: ShaderVariant | null): void {
        if (uri.scheme !== 'file') {
            return;
        }
        // If adding active variant, remove all currently active ones.
        if (variant) {
            if (variant.isActive) {
                for (let [url, file] of this.files) {
                    let needRefresh = false;
                    for (let otherVariant of file.variants) {
                        if (otherVariant.isActive) {
                            needRefresh = true;
                            otherVariant.isActive = false;
                        }
                    }
                    if (needRefresh) {
                        // Refresh file & all its childs
                        this.refresh(file, file);
                    }
                }
            }
        }
        let file = this.files.get(uri);
        if (!file) {
            let newFile : ShaderVariantFile = {
                kind: 'file',
                uri: uri,
                variants: variant ? [variant] : []
            };
            this.files.set(uri, newFile);
            this.refresh(null, this.files.get(uri)!); // This has to be here
        } else if (variant) {
            file.variants.push(variant);
            this.refresh(null, file);
        }
    }
    public close(uri: vscode.Uri): void {
        let file = this.files.get(uri);
        if (file) {
            // We keep it if some variants where defied.
            if (file.variants.length === 0) {
                this.files.delete(uri);
                this.refreshAll();
            }
        }
    }
    async promptEntryPoint() : Promise<string | undefined> {
        return await vscode.window.showInputBox({
            title: "Entry point",
            value: "main",
            prompt: "Select an entry point for your variant. Note that specifying this along the stage might improve performances.",
            placeHolder: "main"
        });
    }
    async promptShaderStage() : Promise<ShaderStage | undefined> {
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
            return ShaderStage[stage as keyof typeof ShaderStage];
        } else {
            return undefined;
        }
    }
    public async add(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            let entryPoint = await this.promptEntryPoint();
            if (entryPoint !== undefined) {
                let stage = await this.promptShaderStage();
                // stage auto is zero...
                if (stage !== undefined) {
                    node.variants.push({
                        kind: 'variant',
                        uri: node.uri,
                        name: entryPoint,
                        isActive: false,
                        stage: {
                            kind: 'stage',
                            stage: stage
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
                }
            }
        } else if (node.kind === 'defineList') {
            let label = await vscode.window.showInputBox({
                title: "Macro label",
                value: "MY_MACRO",
                prompt: "Select a label for you macro.",
                placeHolder: "MY_MACRO"
            });
            if (label) {
                let value = await vscode.window.showInputBox({
                    title: "Macro value",
                    value: "1",
                    prompt: "Select a value for you macro.",
                    placeHolder: "1"
                });
                if (value) {
                    node.defines.push({
                        kind: "define",
                        label: label,
                        value: value,
                    });
                    this.refresh(node, null);
                }
            }
        } else if (node.kind === 'includeList') {
            let include = await vscode.window.showInputBox({
                title: "Include path",
                value: "${workspaceFolder}/",
                prompt: "Select a path for your include.",
                placeHolder: "${workspaceFolder}/"
            });
            if (include) {
                node.includes.push({
                    kind: "include",
                    include: include,
                });
                this.refresh(node, null);
            }
        } else{
            console.error("Unimplemented kind for add", node);
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
                placeHolder: "${workspaceFolder}/"
            });
            if (include) {
                node.include = include;
                this.refresh(node, null);
            }
        } else if (node.kind === 'stage') {
            let stage = await this.promptShaderStage();
            if (stage) {
                node.stage = stage;
                this.refresh(node, null);
            }
        } else {
            console.error("Unimplemented kind for edit", node);
        }
    }
    public async delete(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            // TODO:CONFIG: this might be broken if we delete a file from config that is open in main...
            // Need to check parent if we are inside a database, or disable remove from db via readonly flag...
            // Works for all kind, cuz they all rely on files...
            this.files.delete(node.uri);
            this.refreshAll();
        } else if (node.kind === 'variant') {
            let cachedFile = this.files.get(node.uri);
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
        } else if (node.kind === "database") {
            let result = await vscode.window.showInformationMessage(`Are you sure you want to remove database file "${vscode.workspace.asRelativePath(node.uri)}" ? It cannot be undone.`, { 
                modal: true
            }, "Yes", "No");
            if (result === "Yes") {
                this.database.delete(node.uri);
                this.refreshAll();
            }
        } else {
            console.error("Unimplemented kind for delete", node);
        }
    }
    public onDocumentSymbols(uri: vscode.Uri, symbols: vscode.DocumentSymbol[]) {
        this.notifier.onDocumentSymbols(uri, symbols);
    }
}