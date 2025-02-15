import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

// This should be shadervariant.
export type EntryPoint = {
    kind: 'entryPoint',
    uri: vscode.Uri,
    name: string,
    range: vscode.Range, // TODO: not required, find at runtime as it may change.
    isActive: boolean,
    // Per entry point data
    defines: string[],
    includes: string[],
};

export type EntryPointFile = {
    kind: 'file',
    uri: vscode.Uri,
    entryPoints: EntryPoint[],
};
export type EntryPointNode = EntryPoint | EntryPointFile;

export class EntryPointTreeDataProvider implements vscode.TreeDataProvider<EntryPoint | EntryPointFile> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<EntryPointNode | undefined | void> = new vscode.EventEmitter<EntryPointNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPointNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private files: Map<vscode.Uri, EntryPointFile> = new Map;

    public refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: EntryPointNode): vscode.TreeItem {
        if (element.kind === 'entryPoint') {
            let item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
            item.command = {
                title: "Go to entry point",
                command: 'shader-validator.setCurrentEntryPoint',
                arguments: [element]
            };
            item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
            item.iconPath = new vscode.ThemeIcon('code');
            item.contextValue = "entryPoint";
            return item;
        } else if (element.kind === 'file') {
            let item = new vscode.TreeItem(element.uri.fsPath, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = vscode.ThemeIcon.File;
            item.contextValue = "file";
            return item;
        } else {
            return undefined!; // unreachable
        }
    }

    public getChildren(element?: EntryPointNode): EntryPointNode[] | Thenable<EntryPointNode[]> {
        if (element) {
            if (element.kind === 'entryPoint') {
                return [];
            } else if (element.kind === 'file') {
                return element.entryPoints;
            } else {
                return undefined!; // unreachable
            }
        } else {
            // Convert to array
            return Array.from(this.files.values());
        }
    }

    public addEntryPoint(uri: vscode.Uri, name: string): void {
        let cachedFile = this.files.get(uri);
        let newEntryPoint : EntryPoint = {
            kind: 'entryPoint',
            uri: uri,
            name: name,
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            isActive: false,
            defines: [],
            includes: []
        };
        if (cachedFile) {
            cachedFile.entryPoints.push(newEntryPoint);
        } else {
            let newFile : EntryPointFile = {
                kind: 'file',
                uri: uri,
                entryPoints: [newEntryPoint]
            };
            this.files.set(uri, newFile);
        }
        this.refresh();
    }
    public deleteEntryPoint(entryPoint: EntryPoint): void {
        let cachedFile = this.files.get(entryPoint.uri);
        if (cachedFile) {
            let index = cachedFile.entryPoints.indexOf(entryPoint);
            if (index > -1) {
                delete cachedFile.entryPoints[index];
            }
        }
        this.refresh();
    }

    public clearEntryPoint(uri: vscode.Uri): void {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === "file") {
                cachedFile.entryPoints = [];
                this.refresh();
            } else {
                // unreachable
            }
        } else {
            console.warn("No cached file ", uri);
        }
    }
    public addFile(uri: vscode.Uri): void {
        let newFile : EntryPointFile = {
            kind: 'file',
            uri: uri,
            entryPoints: []
        };
        this.files.set(uri, newFile);
        this.refresh();
    }
    public deleteFile(uri: vscode.Uri): void {
        this.files.delete(uri);
        this.refresh();
    }
    public visitEntryPoints(uri: vscode.Uri, callback: (e:string, r: vscode.Range, active: boolean) => void) {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === 'file') {
                for (let file of cachedFile.entryPoints) {
                    callback(file.name, file.range, file.isActive);
                }
            }
        }
    }
}

export class EntryPointDataTreeDataProvider implements vscode.TreeDataProvider<EntryPoint> {
    private onDidChangeTreeDataEmitter: vscode.EventEmitter<EntryPoint | undefined | void> = new vscode.EventEmitter<EntryPoint | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPoint | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private currentEntryPoint: EntryPoint | null = null;
    
    refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: EntryPoint): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            label: "variant",
        };
    }
    getChildren(element?: EntryPoint | undefined): vscode.ProviderResult<EntryPoint[]> {
        if (element) {
            // We need a define child, an include child with + button & command.
            return []; // No child here. Single element.
        } else if (this.currentEntryPoint) {
            return [this.currentEntryPoint];
        } else {
            return [];
        }
    }

    setCurrentEntryPoint(entryPoint: EntryPoint | null) {
        console.log("New entry point: ", entryPoint);
        this.currentEntryPoint = entryPoint;
        this.refresh();
    }

}

export class ShaderVariantEditor implements vscode.WebviewViewProvider {
    
    private currentEntryPoint: EntryPoint | null = null;

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        webviewView.webview.options = {
            enableScripts: true,
        };
        webviewView.webview.html = "<!doctype><html><p></p><input type=\"text\"/></html>";
    }
    setCurrentEntryPoint(entryPoint: EntryPoint | null) {
        console.log("New entry point: ", entryPoint);
        this.currentEntryPoint = entryPoint;
    }

}

