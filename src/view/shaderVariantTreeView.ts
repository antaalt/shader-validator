import * as vscode from 'vscode';
import { CancellationToken, DocumentSymbol, DocumentSymbolRequest, DocumentUri, LanguageClient, ProtocolNotificationType, ProtocolRequestType, Range, SymbolInformation, SymbolKind, TextDocumentIdentifier, TextDocumentItem, TextDocumentRegistrationOptions } from 'vscode-languageclient/node';
import { resolveVSCodeVariables, ShaderLanguageClient } from '../client';
import path from 'path';

interface ShaderVariantSerialized {
    url: DocumentUri,
    shadingLanguage: string,
    entryPoint: string,
    stage: string | null,
    defines: Object,
    includes: string[],
}

function shaderVariantToSerialized(url: DocumentUri, languageId: string, e: ShaderVariant) : ShaderVariantSerialized {
    return {
        url: url,
        shadingLanguage: languageId,
        entryPoint: e.name,
        stage: (e.stage.stage === ShaderStage.auto) ? null : ShaderStage[e.stage.stage],
        defines: Object.fromEntries(e.defines.defines.map(e => [e.label, e.value])),
        includes: e.includes.includes.map(e => resolveVSCodeVariables(e.include))
    };
}

// using vscode.Uri as key to Map does not work as it compare by ref and not value... So we can have duplicated keys...
// Using this wrapper to fix this by using underlying string as key.
class UriMap<V> implements Iterable<[vscode.Uri, V]> {
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

function serializeShaderVariantNode(data: ShaderVariantNode): string {
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
function deserializeShaderVariantNode(data: string): ShaderVariantFile[] {
    const json = JSON.parse(data);
    if (Array.isArray(json)) {
        return json.map(data => deserializeShaderVariantFile(data));
    } else {
        throw new SyntaxError("Incorrect database format: not an array");
    }
}

// Notification from client to change shader variant
interface DidChangeShaderVariantParams {
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

export type ShaderEntryPoint = {
    entryPoint: string,
    range: vscode.Range,
};

export type ShaderVariantNode = ShaderVariant | ShaderVariantFile | ShaderVariantDefineList | ShaderVariantIncludeList | ShaderVariantDefine | ShaderVariantInclude | ShaderVariantStage | ShaderVariantRoot | ShaderVariantDatabase;

const shaderVariantTreeKey : string = 'shader-validator.shader-variant-tree-key';

export class ShaderVariantTreeDataProvider implements vscode.TreeDataProvider<ShaderVariantNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderVariantNode | undefined | void> = new vscode.EventEmitter<ShaderVariantNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderVariantNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private files: UriMap<ShaderVariantFile>;
    private database: UriMap<Map<vscode.Uri, ShaderVariantFile>>;

    // Serialization & Editor
    private server: ShaderLanguageClient;
    private tree: vscode.TreeView<ShaderVariantNode>;
    private decorator: Map<string, vscode.TextEditorDecorationType>;
    private workspaceState: vscode.Memento;
    // Async symbol loading
    private shaderEntryPointList: UriMap<ShaderEntryPoint[]>;
    private asyncGoToShaderEntryPoint: UriMap<string>;

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
        let array = Array.from(this.files.values());
        this.workspaceState.update(shaderVariantTreeKey, array);
    }

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.workspaceState = context.workspaceState;
        this.files = new UriMap;
        this.database = new UriMap;
        this.load();
        this.shaderEntryPointList = new UriMap;
        this.server = server;
        this.tree = vscode.window.createTreeView<ShaderVariantNode>("shader-validator-variants", {
            treeDataProvider: this
            // TODO: drag and drop for better ux.
            //dragAndDropController:
        });
        this.asyncGoToShaderEntryPoint = new UriMap;
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
            this.notifyVariantChanged();
            this.save();
            this.updateDecorations();
        });
        this.decorator = new Map;
        const supportedLangIds = ShaderLanguageClient.getSupportedLangId();
        for (var supportedLangId of supportedLangIds) {
            this.decorator.set(supportedLangId, vscode.window.createTextEditorDecorationType({
                // Icon
                gutterIconPath: context.asAbsolutePath(`./res/icons/${supportedLangId}-icon.svg`),
                gutterIconSize: "contain",
                // Minimap
                overviewRulerColor: "rgb(0, 174, 255)",
                overviewRulerLane: vscode.OverviewRulerLane.Full,
                rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
                // Border
                borderWidth: '1px',
                borderStyle: 'solid',
            }));
        }
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
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.gotoShaderEntryPoint", (uri: vscode.Uri, entryPointName: string) => {
            // sometimes, its goes in random place in file... 
            // TODO: Should use regex & read diag region instead.
            let diagnostic = vscode.languages.getDiagnostics().find(([diagUri, diags]) => diagUri === uri);
            
            this.goToShaderEntryPoint(uri, entryPointName, true);
        }));
        // Prepare entry point symbol cache
        for (let editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.shaderEntryPointList.set(editor.document.uri, []);
            }
        }
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.scheme === 'file') {
                this.shaderEntryPointList.set(document.uri, []);
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
            this.shaderEntryPointList.delete(document.uri);
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
                // Also update entry point and async maps
                const entryPoints = this.shaderEntryPointList.get(oldPath);
                if (entryPoints) {
                    this.shaderEntryPointList.delete(oldPath);
                    this.shaderEntryPointList.set(newPath, entryPoints);
                }
                const asyncEntryPoint = this.asyncGoToShaderEntryPoint.get(oldUri);
                if (asyncEntryPoint) {
                    this.asyncGoToShaderEntryPoint.delete(oldUri);
                    this.asyncGoToShaderEntryPoint.set(newUri, asyncEntryPoint);
                }
                this.shaderEntryPointList;
                this.asyncGoToShaderEntryPoint;
            }
        }));
        this.onServerStart();
    }
    onServerStart() {
        this.updateDependencies();
    }
    dispose() {
        // Nothing to do here.
    }
    private async loadDatabase(fileUri: vscode.Uri) {
        // TODO:CONFIG: vscode.workspace.createFileSystemWatcher
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
    private getActiveVariant() : ShaderVariant | null {
        for (const file of this.files.values()) {
            const activeVariant = file.variants.find((e: ShaderVariant) => e.isActive);
            if (activeVariant) {
                return activeVariant;
            }
        }
        return null;
    }
    private hasActiveVariant(file: ShaderVariantFile) : ShaderVariant | null {
        const activeVariant = file.variants.find((e: ShaderVariant) => e.isActive);
        if (activeVariant) {
            return activeVariant;
        }
        return null;
    }

    private goToShaderEntryPoint(uri: vscode.Uri, entryPointName: string, defer: boolean) {
        let shaderEntryPointList = this.shaderEntryPointList.get(uri);
        let entryPoint = shaderEntryPointList?.find(e => e.entryPoint === entryPointName);
        // TOOD: Could instead regex + check regions via vscode.
        if (entryPoint) {
            vscode.commands.executeCommand('vscode.open', uri, <vscode.TextDocumentShowOptions>{
                selection: entryPoint.range
            });
        } else {
            let editor = vscode.window.visibleTextEditors.find(e => e.document.uri === uri);
            if (editor || !defer) {
                // Already opened, but no entry point found.
                vscode.window.showWarningMessage(`Failed to find entry point ${entryPointName} for file ${vscode.workspace.asRelativePath(uri)}`);
            } else {
                // Store request & open the file. Resolve goto on document request
                this.asyncGoToShaderEntryPoint.set(uri, entryPointName);
                vscode.commands.executeCommand('vscode.open', uri, <vscode.TextDocumentShowOptions>{});
            }
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
            this.updateDependency(file);
        } else if (node) {
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
    private notifyVariantChanged() {
        function capitalizeFirstLetter(str: string): string {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }
        // Notify server of change.
        let fileActiveVariant = this.getActiveVariant();
        if (fileActiveVariant) {
            // Open document to get language ID.
            // This does not open the document in the editor, only internally.
            vscode.workspace.openTextDocument(fileActiveVariant.uri).then(doc => {
                this.server.sendNotification(didChangeShaderVariantNotification, {
                    // Need this check again here because its async
                    shaderVariant: fileActiveVariant ? shaderVariantToSerialized(
                        this.server.uriAsString(fileActiveVariant.uri), 
                        capitalizeFirstLetter(doc.languageId), // Server expect it with capitalized first letter.
                        fileActiveVariant
                    ) : null,
                });
            });
        } else {
            this.server.sendNotification(didChangeShaderVariantNotification, {
                shaderVariant: null,
            });
        }
        
    }
    private requestDocumentSymbol(uri: vscode.Uri) {
        // TODO: should request inlay hint aswell.
        // This one seems to get symbol from cache without requesting the server...
        //vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", file.uri);
        // This one works, but result is not intercepted by vscode & updated...
        //this.client.sendRequest(DocumentSymbolRequest.type, {
        //    textDocument: {
        //        uri: this.client.code2ProtocolConverter.asUri(file.uri),
        //    }
        //});
        // We have to rely on a dirty hack instead.
        // Need to check this does not break anything
        // Dirty hack to trigger document symbol update
        // Ideally, it should retrigger dependencies aswell.
        // See https://github.com/microsoft/vscode/issues/108722 (Old one https://github.com/microsoft/vscode/issues/71454)

        // Only trigger it if requested by user as it may be a bit invasive.
        let updateSymbolsOnVariantUpdate = vscode.workspace.getConfiguration("shader-validator").get<boolean>("updateSymbolsOnVariantUpdate");
        if (updateSymbolsOnVariantUpdate) {
            let visibleEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.path === uri.path);
            if (visibleEditor) {
                let editor = visibleEditor;
                editor.edit(editBuilder => {
                    for (let iLine = 0; iLine < editor.document.lineCount; iLine++) {
                        // Find first non-empty line to avoid crashing on empty line with negative position.
                        let line = editor.document.lineAt(iLine);
                        if (line.text.length > 0) {
                            const text = line.text;
                            const c = line.range.end.character;
                            // Remove last character of first line and add it back.
                            editBuilder.delete(new vscode.Range(iLine, c-1, iLine, c));
                            editBuilder.insert(new vscode.Position(iLine, c), text[c-1]);
                            break;
                        }
                    }
                    // All empty lines means no symbols !
                });
            }
        }
    }
    private updateDependency(file: ShaderVariantFile) {
        // When editing variant, might need to send it if holding an active one.
        if (this.hasActiveVariant(file))  {
            this.notifyVariantChanged();
        }
        // Symbols might have changed, so request them as we use this to compute symbols.
        this.requestDocumentSymbol(file.uri);
    }
    public onDocumentSymbols(uri: vscode.Uri, symbols: vscode.DocumentSymbol[]) {
        // TODO:TREE: need to recurse child as well.
        this.shaderEntryPointList.set(uri, symbols.filter(symbol => symbol.kind === vscode.SymbolKind.Function).map(symbol => {
            return {
                entryPoint: symbol.name, 
                range: symbol.selectionRange
            };
        }));
        // Solve async request for goto.
        let entryPoint = this.asyncGoToShaderEntryPoint.get(uri);
        if (entryPoint) {
            this.asyncGoToShaderEntryPoint.delete(uri);
            this.goToShaderEntryPoint(uri, entryPoint, false);
        }
        this.updateDecorations();
    }
    private updateDependencies() {
        for (let [_, file] of this.files) {
            this.updateDependency(file);
        }
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
            let result = await vscode.window.showInformationMessage(`Are you sure you want to remove database ${node.uri.path} ? It cannot be undone.`, { 
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
    private getDecorator(langId: string) : vscode.TextEditorDecorationType {
        // Use decorator or a default one.
        return this.decorator.get(langId) || vscode.window.createTextEditorDecorationType({
            // Minimap
            overviewRulerColor: "rgb(0, 174, 255)",
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            // Border
            borderWidth: '1px',
            borderStyle: 'solid',
        });
    }
    private updateDecoration(editor: vscode.TextEditor) {
        let file = this.files.get(editor.document.uri);
        let entryPoints = this.shaderEntryPointList.get(editor.document.uri);

        let variant = this.getActiveVariant();
        if (file && entryPoints) {
            if (variant) {
                let found = false;
                for (let entryPoint of entryPoints) {
                    if (entryPoint.entryPoint === variant.name) {
                        let decorations : vscode.DecorationOptions[]= [];
                        decorations.push({ range: entryPoint.range, hoverMessage: variant.name });
                        editor.setDecorations(this.getDecorator(editor.document.languageId), decorations);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.info("Entry point not found in ", entryPoints);
                    editor.setDecorations(this.getDecorator(editor.document.languageId), []);
                }
            } else {
                console.info("No active variant ", entryPoints);
                editor.setDecorations(this.getDecorator(editor.document.languageId), []);
            }
        } else {
            editor.setDecorations(this.getDecorator(editor.document.languageId), []);
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