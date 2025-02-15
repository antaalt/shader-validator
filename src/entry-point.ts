import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

export type EntryPointDefine = {
    kind: 'define',
    label: string,
    value: string,
};

export type EntryPointDefineList = {
    kind: 'defineList',
    defines: EntryPointDefine[],
};

export type EntryPointInclude = {
    kind: 'include',
    include: string,
};

export type EntryPointIncludeList = {
    kind: 'includeList',
    includes: EntryPointInclude[],
};

// This should be shadervariant.
export type EntryPoint = {
    kind: 'entryPoint',
    uri: vscode.Uri,
    name: string,
    isActive: boolean,
    // Per entry point data
    defines: EntryPointDefineList,
    includes: EntryPointIncludeList,
};

export type EntryPointFile = {
    kind: 'file',
    uri: vscode.Uri,
    entryPoints: EntryPoint[],
};

export type EntryPointNode = EntryPoint | EntryPointFile | EntryPointDefineList | EntryPointIncludeList | EntryPointDefine | EntryPointInclude;

export class EntryPointTreeDataProvider implements vscode.TreeDataProvider<EntryPointNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<EntryPointNode | undefined | void> = new vscode.EventEmitter<EntryPointNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPointNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private files: Map<vscode.Uri, EntryPointFile> = new Map;

    public refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }

    public getTreeItem(element: EntryPointNode): vscode.TreeItem {
        if (element.kind === 'entryPoint') {
            let item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.command = {
                title: "Go to entry point",
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
            let item = new vscode.TreeItem("Defines", vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'includeList') {
            let item = new vscode.TreeItem("Includes", vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'define') {
            let item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.contextValue = element.kind;
            return item;
        } else if (element.kind === 'include') {
            let item = new vscode.TreeItem(element.include, vscode.TreeItemCollapsibleState.None);
            item.contextValue = element.kind;
            return item;
        } else {
            console.error("Unimplemented kind: ", element);
            return undefined!; // unreachable
        }
    }

    public getChildren(element?: EntryPointNode): EntryPointNode[] | Thenable<EntryPointNode[]> {
        if (element) {
            if (element.kind === 'entryPoint') {
                return [element.includes, element.defines];
            } else if (element.kind === 'file') {
                return element.entryPoints;
            } else if (element.kind === 'includeList') {
                return element.includes;
            } else if (element.kind === 'defineList') {
                return element.defines;
            } else if (element.kind === 'include') {
                return [];
            } else if (element.kind === 'define') {
                return [];
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
            isActive: false,
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
    public visitEntryPoints(uri: vscode.Uri, callback: (e:string, active: boolean) => void) {
        let cachedFile = this.files.get(uri);
        if (cachedFile) {
            if (cachedFile.kind === 'file') {
                for (let file of cachedFile.entryPoints) {
                    callback(file.name, file.isActive);
                }
            }
        }
    }
}