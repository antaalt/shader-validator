import * as vscode from 'vscode';
import { resolveVSCodeVariables, ShaderLanguageClient } from '../../client';
import { deserializeShaderVariantNode, ShaderStage, ShaderVariant, ShaderVariantDatabase, ShaderVariantFile, ShaderVariantNode, ShaderVariantRoot, UriMap } from './variant';
import { ShaderVariantNotifier } from './shaderVariantNotifier';
import { CompileShaderResult, decodeCompileShaderData, getCompiledShaderExtension } from '../../request';
import path from 'path';

const shaderVariantTreeKey : string = 'shader-validator.shader-variant-tree-key';
const shaderVariantDatabaseKey : string = 'shader-validator.shader-variant-database-key';

export class ShaderVariantTreeDataProvider implements vscode.TreeDataProvider<ShaderVariantNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderVariantNode | undefined | void> = new vscode.EventEmitter<ShaderVariantNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderVariantNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private notifier: ShaderVariantNotifier;
    private files: UriMap<ShaderVariantFile>;
    private database: UriMap<UriMap<ShaderVariantFile>>;
    private databaseWatcher: UriMap<vscode.FileSystemWatcher>;

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
        let databaseUris : string[] = this.workspaceState.get<string[]>(shaderVariantDatabaseKey, []);
        for (let databseUri of databaseUris) {
            this.loadDatabase(vscode.Uri.parse(databseUri));
        }
    }
    private save() {
        let treeArray = Array.from(this.files.values());
        this.workspaceState.update(shaderVariantTreeKey, treeArray);
        let databaseArray = Array.from(this.database.keys());
        this.workspaceState.update(shaderVariantDatabaseKey, databaseArray);
    }

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.workspaceState = context.workspaceState;
        this.files = new UriMap;
        this.database = new UriMap;
        this.databaseWatcher = new UriMap;
        this.notifier = new ShaderVariantNotifier(context, server);
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
                        let file = this.getNodeVariantFile(variant);
                        if (file) {
                            // Need to unset other possibles active ones to keep only one entry point active.
                            for (let [url, file] of this.files) {
                                for (let otherVariant of file.variants) {
                                    if (otherVariant.isActive) {
                                        otherVariant.isActive = false;
                                            this.updateTreeView(otherVariant);
                                    }
                                }
                            }
                            for (let [databaseUrl, database] of this.database) {
                                for (let [url, file] of database) {
                                    for (let otherVariant of file.variants) {
                                        if (otherVariant.isActive) {
                                            otherVariant.isActive = false;
                                            this.updateTreeView(otherVariant);
                                        }
                                    }
                                }
                            }
                            variant.isActive = true; // checked
                            this.updateActiveVariant(file, variant);
                            this.updateTreeView(file);
                        }
                    } else {
                        variant.isActive = false; // unchecked
                        let file = this.getNodeVariantFile(variant);
                        if (file) {
                            this.updateActiveVariant(file, null);
                        }
                    }
                }
            }
            this.save();
            this.notifier.updateDecorations();
        });
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.loadVariantDatabaseFromUri", async (uri: vscode.Uri) => {
            console.info("Loading database from uri", uri);
            await this.loadDatabase(uri, context.extensionMode === vscode.ExtensionMode.Test);
        }));
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
                    console.info("Loading database ", fileUri);
                    await this.loadDatabase(fileUri);
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
                    if (stage !== undefined) {
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
        context.subscriptions.push(vscode.workspace.onDidRenameFiles(document => {
            for (const fileObj of document.files) {
                const { oldUri, newUri } = fileObj;
                // To update the key in a Map, you need to remove the old key and add the new one.
                const oldPath = oldUri;
                const newPath = newUri;
                const file = this.files.get(oldPath);
                if (file) {
                    // Update the uri inside the file object
                    file.uri = newUri;
                    // Remove the old key and set the new key
                    this.files.delete(oldPath);
                    this.files.set(newPath, file);
                }
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addMenu", async (node: ShaderVariantNode) => {
            let file = this.getNodeVariantFile(node);
            if (file && file.database) {
                vscode.window.showWarningMessage("Trying to add to a database. Edit JSON and refresh instead to avoid losing content.")
            } else {
                await this.add(node);
                this.save();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", async (node: ShaderVariantNode) => {
            let file = this.getNodeVariantFile(node);
            if (file && file.database) {
                vscode.window.showWarningMessage("Trying to delete to a database. Edit JSON and refresh instead to avoid losing content.")
            } else {
                await this.delete(node);
                this.save();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.refreshMenu", (node: ShaderVariantNode) => {
            if (node.kind === 'database') {
                this.loadDatabase(node.uri);
                this.updateTreeView();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            let file = this.getNodeVariantFile(node);
            if (file && file.database) {
                vscode.window.showWarningMessage("Trying to edit to a database. Edit JSON and refresh instead to avoid losing content.")
            } else {
                await this.edit(node);
                this.save();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.compileMenu", async (node: ShaderVariantNode) => {
            if (node.kind === 'variant') {
                let file = this.getNodeVariantFile(node);
                if (file) {
                    // Need to unset other possibles active ones to keep only one entry point active.
                    for (let [url, file] of this.files) {
                        for (let otherVariant of file.variants) {
                            if (otherVariant.isActive) {
                                otherVariant.isActive = false;
                                this.updateTreeView(otherVariant);
                            }
                        }
                    }
                    for (let [databaseUrl, database] of this.database) {
                        for (let [url, file] of database) {
                            for (let otherVariant of file.variants) {
                                if (otherVariant.isActive) {
                                    otherVariant.isActive = false;
                                    this.updateTreeView(otherVariant);
                                }
                            }
                        }
                    }
                    node.isActive = true; // checked
                    this.updateActiveVariant(file, node);
                    this.updateTreeView(node);
                    let compilationResult = (await vscode.commands.executeCommand(
                        'shader-validator.compileShader',
                        node.uri
                    )) as CompileShaderResult | null;
                    if (compilationResult) {
                        let saveLocation = await vscode.window.showSaveDialog({
                            title: 'Save compilation result',
                            saveLabel: "Save",
                            defaultUri: vscode.Uri.file(path.basename(node.uri.path) + getCompiledShaderExtension(compilationResult)),
                        });
                        if (saveLocation) {
                            await vscode.workspace.fs.writeFile(saveLocation, decodeCompileShaderData(compilationResult.data));
                            console.info('Save ', compilationResult.compilationType);
                        } else {
                            vscode.window.showErrorMessage("Failed to find a valid location to save compilation result.")
                        }
                    } else {
                        vscode.window.showErrorMessage("Failed to compile shader variant.")
                    }
                }
            }
        }));
        this.onServerStart();
    }
    onServerStart() {
        for (let [uri, file] of this.files) {
            for (let variant of file.variants) {
                if (variant.isActive) {
                    this.updateActiveVariant(file, variant);
                    break;
                }
            }
        }
    }
    dispose() {
        // Nothing to do here.
    }
    private async loadDatabase(fileUri: vscode.Uri, isTest?: boolean) {
        try {
            const file = await vscode.workspace.fs.readFile(fileUri);
            const database = deserializeShaderVariantNode(file.toString());
            let databaseMap = new UriMap(database.map((e : ShaderVariantFile) => {
                return [e.uri, e];
            }));
            // Reset variant if its inside db.
            let oldDatabase = this.database.get(fileUri);
            if (oldDatabase) {
                for (let [uri, file] of oldDatabase) {
                    for (let variant of file.variants) {
                        if (variant.isActive) {
                            this.updateActiveVariant(file, null);
                            break;
                        }
                    }
                }
            }
            if (isTest === true) {
                // Set first variant as active for testing purpose
                databaseMap.forEach((file, _key, _map) => {
                    // Hardcoded value for now.
                    file.variants[0].isActive = true;
                    this.updateActiveVariant(file, file.variants[0]);
                });
            }
            this.database.set(fileUri, databaseMap);
            this.updateTreeView();
            // Watch file for changes.
            const folderUri = vscode.Uri.joinPath(fileUri, '..');
            const fileName = fileUri.path.substring(fileUri.path.lastIndexOf('/') + 1);
            let watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folderUri, fileName));
            watcher.onDidChange((uri: vscode.Uri) => {
                if (uri.fsPath === fileUri.fsPath) {
                    this.loadDatabase(fileUri);
                }
            });
            // Deleted then recreated (or fixed after a bad write).
            watcher.onDidCreate((uri: vscode.Uri) => {
                if (uri.fsPath === fileUri.fsPath) {
                    this.loadDatabase(fileUri);
                    this.updateTreeView();
                }
            });
            watcher.onDidDelete((uri: vscode.Uri) => {
                if (uri.fsPath === fileUri.fsPath) {
                    this.database.delete(uri);
                    this.updateTreeView();
                }
            });
            let oldWatcher = this.databaseWatcher.get(fileUri);
            if (oldWatcher) {
                oldWatcher.dispose();
            }
            this.databaseWatcher.set(fileUri, watcher);
        } catch (e) {
            let error = e as SyntaxError;
            vscode.window.showErrorMessage(`Failed to load variant database ${vscode.workspace.asRelativePath(fileUri)}: ${error.message}`);
        }
    }
    getParent(element: ShaderVariantNode): vscode.ProviderResult<ShaderVariantNode> {
        // TODO: should store parents if perf become critical as looping like this might be heavy.
        function findParent(file: ShaderVariantFile) : ShaderVariantNode | null {
            if (element === file) {
                console.assert(element.kind === 'file');
                return null; //database; // Not a node, cant return...
            }
            for (let variant of file.variants) {
                if (element === variant) {
                    console.assert(element.kind === 'variant');
                    return file;
                }
                if (element === variant.stage) {
                    console.assert(element.kind === 'stage');
                    return variant;
                }
                if (element === variant.defines) {
                    console.assert(element.kind === 'defineList');
                    return variant;
                }
                if (element === variant.includes) {
                    console.assert(element.kind === 'includeList');
                    return variant;
                }
                for (let define of variant.defines.defines) {
                    if (element === define) {
                        console.assert(element.kind === 'define');
                        return variant.defines;
                    }
                }
                for (let include of variant.includes.includes) {
                    if (element === include) {
                        console.assert(element.kind === 'include');
                        return variant.includes;
                    }
                }
            }
            return null;
        }
        for (let [uri, file] of this.files) {
            let parent = findParent(file);
            if (parent !== null) {
                return parent;
            }
        }
        for (let [databaseUri, database] of this.database) {
            for (let [uri, file] of database) {
                let parent = findParent(file);
                if (parent !== null) {
                    return parent;
                }
            }
        }
        return null;
    }
    private getNodeVariant(node: ShaderVariantNode) : ShaderVariant | null {
        let activeParent : ShaderVariantNode | null = node;
        while (activeParent !== null) {
            if (activeParent.kind === 'variant') {
                return activeParent;
            }
            activeParent = this.getParent(activeParent) as ShaderVariant | null;
        }
        return null;
    }
    private getNodeVariantFile(node: ShaderVariantNode) : ShaderVariantFile | null {
        let activeParent : ShaderVariantNode | null = node;
        while (activeParent !== null) {
            if (activeParent.kind === 'file') {
                return activeParent;
            }
            activeParent = this.getParent(activeParent) as ShaderVariantFile | null;
        }
        return null;
    }

    public updateTreeView(node?: ShaderVariantNode) {
        this.onDidChangeTreeDataEmitter.fire(node);
    }
    public updateActiveVariant(file: ShaderVariantFile, node: ShaderVariant | null) {
        this.notifier.notifyVariantChanged(file, node);
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
            item.command = {
                title: "Go to file",
                command: 'vscode.open',
                arguments: [
                    element.uri,
                ]
            };
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
            item.command = {
                title: "Go to database",
                command: 'vscode.open',
                arguments: [
                    element.uri,
                ]
            };
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
            console.error("Trying to open non file uri");
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
                        // Refresh file symbols
                        this.updateActiveVariant(file, null);
                        this.updateTreeView(file);
                    }
                }
            }
        }
        let file = this.files.get(uri);
        if (!file) {
            let newFile : ShaderVariantFile = {
                kind: 'file',
                uri: uri,
                database: false,
                variants: variant ? [variant] : []
            };
            this.files.set(uri, newFile);
            if (variant && variant.isActive) {
                this.updateActiveVariant(newFile, variant);
            }
            // Update whole tree as we added something at its root
            this.updateTreeView();
        } else if (variant) {
            file.variants.push(variant);
            if (variant && variant.isActive) {
                this.updateActiveVariant(file, variant);
            }
            // Only update this file node.
            this.updateTreeView(file);
        }
    }
    public close(uri: vscode.Uri): void {
        let file = this.files.get(uri);
        if (file) {
            // We keep it if some variants where defined.
            if (file.variants.length === 0) {
                this.files.delete(uri);
                this.updateTreeView();
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
        if (stage !== undefined) {
            return ShaderStage[stage as keyof typeof ShaderStage];
        } else {
            return undefined;
        }
    }
    getFileActiveVariant(file: ShaderVariantFile): ShaderVariant | null {
        for (let variant of file.variants) {
            if (variant.isActive) {
                return variant;
            }
        }
        return null;
    }
    getActiveVariant() : ShaderVariant | null {
        for (let [uri, file] of this.files) {
            let variant = this.getFileActiveVariant(file);
            if (variant && variant.isActive) {
                return variant;
            }
        }
        for (let [databaseUri, database] of this.database) {
            for (let [uri, file] of database) {
                let variant = this.getFileActiveVariant(file);
                if (variant && variant.isActive) {
                    return variant;
                }
            }
        }
        return null;
    }
    public async add(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            let entryPoint = await this.promptEntryPoint();
            if (entryPoint !== undefined) {
                let stage = await this.promptShaderStage();
                // stage might be zero but valid
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
                    this.updateTreeView(node);
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
                    // Update file here as we want to update its description aswell
                    let variant = this.getNodeVariant(node);
                    if (variant) {
                        let file = this.getNodeVariantFile(variant);
                        if (file) {
                            if (variant.isActive) {
                                this.updateActiveVariant(file, variant);
                            }
                        }
                        // Update variant as it impact description
                        this.updateTreeView(variant);
                    } else {
                        this.updateTreeView(node);
                    }
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
                let variant = this.getNodeVariant(node);
                if (variant) {
                    let file = this.getNodeVariantFile(variant);
                    if (file && variant.isActive) {
                        this.updateActiveVariant(file, variant);
                    }
                }
                this.updateTreeView(node);
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
                this.updateTreeView(node);
                if (node.isActive) {
                    let file = this.getNodeVariantFile(node);
                    if (file && node.isActive) {
                        this.updateActiveVariant(file, node);
                    }
                }
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
                let variant = this.getNodeVariant(node);
                if (variant) {
                    let file = this.getNodeVariantFile(variant);
                    if (file && variant.isActive) {
                        this.updateActiveVariant(file, variant);
                    }
                    // Update variant here as we want to update its description aswell
                    this.updateTreeView(variant);
                } else {
                    this.updateTreeView(node);
                }
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
                let variant = this.getNodeVariant(node);
                if (variant) {
                    let file = this.getNodeVariantFile(variant);
                    if (file && variant.isActive) {
                        this.updateActiveVariant(file, variant);
                    }
                }
                this.updateTreeView(node);
            }
        } else if (node.kind === 'stage') {
            let stage = await this.promptShaderStage();
            if (stage !== undefined) {
                node.stage = stage;
                this.updateTreeView(node);
                let variant = this.getNodeVariant(node);
                if (variant) {
                    let file = this.getNodeVariantFile(variant);
                    if (file && variant.isActive) {
                        this.updateActiveVariant(file, variant);
                    }
                }
            }
        } else {
            console.error("Unimplemented kind for edit", node);
        }
    }
    public async delete(node: ShaderVariantNode) {
        if (node.kind === 'file') {
            // TODO: handle if database or not...
            // Need to cache root node & database not for this to get through parents...
            let file = this.files.get(node.uri);
            // Disable variant if it was inside...
            if (file && this.getFileActiveVariant(file) !== null) {
                this.updateActiveVariant(file, null);
            }
            if (file && file === node) {
                this.files.delete(node.uri);
                this.updateTreeView();
            }
        } else if (node.kind === 'variant') {
            let cachedFile = this.files.get(node.uri);
            if (cachedFile) {
                let index = cachedFile.variants.indexOf(node);
                if (index > -1) {
                    if (node.isActive) {
                        this.updateActiveVariant(cachedFile, null);
                    }
                    cachedFile.variants.splice(index, 1);
                    this.updateTreeView(cachedFile);
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
                        this.updateTreeView(file);
                        if (variant.isActive) {
                            this.updateActiveVariant(file, variant);
                        }
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
                        this.updateTreeView(variant);
                        if (variant.isActive) {
                            this.updateActiveVariant(file, variant);
                        }
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
                this.updateTreeView();
            }
        } else {
            console.error("Unimplemented kind for delete", node);
        }
    }
    public onDocumentSymbols(uri: vscode.Uri, symbols: vscode.DocumentSymbol[]) {
        this.notifier.onDocumentSymbols(uri, symbols);
    }
}