import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

class EntryPointNode extends vscode.TreeItem {
    children: EntryPointNode[] | undefined;
  
    constructor(uri: vscode.Uri, range: vscode.Range, entryPoint? : string) {
        let isEntryPoint = entryPoint ? true : false;
        super(
            entryPoint || uri.fsPath,
            isEntryPoint ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded
        );
        this.resourceUri = uri;
		this.contextValue = isEntryPoint ? 'open-item' : undefined;
        this.command = isEntryPoint ? {
            title: "Go to entry point",
            command: 'vscode.open',
			arguments: [
				uri,
				<vscode.TextDocumentShowOptions>{
					selection: range
				}
			]
        } : undefined;
        this.checkboxState = isEntryPoint ? vscode.TreeItemCheckboxState.Unchecked : undefined;
        this.iconPath = isEntryPoint ? new vscode.ThemeIcon('code') : vscode.ThemeIcon.File;
        this.children = [];
    }
    isEntryPoint() : boolean {
        return this.collapsibleState === vscode.TreeItemCollapsibleState.None;
    }
    addEntryPoint(entryPoint: string, range: vscode.Range) {
        this.children?.push(new EntryPointNode(this.resourceUri!, range, entryPoint));
    }
    clearEntryPoints() {
        this.children = [];
    }
}
export class EntryPointTreeDataProvider implements vscode.TreeDataProvider<EntryPointNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<EntryPointNode | undefined | void> = new vscode.EventEmitter<EntryPointNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPointNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;
    
    // Array or map ?
    private entryPoints : Map<vscode.Uri, EntryPointNode> = new Map;

    
    constructor() {
    }

    public refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }


    public getTreeItem(element: EntryPointNode): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: EntryPointNode): EntryPointNode[] | Thenable<EntryPointNode[]> {
        if (element) {
            return element.children || [];
        } else {
            return Array.from(this.entryPoints.values());
        }
    }

    public addEntryPoint(uri: vscode.Uri, range: vscode.Range, entryPoint: string): void {
        //console.info(`Adding possible entry point for file ${uri}: ${entryPoint}`);
        let file = this.entryPoints.get(uri);
        if (file) {
            file.addEntryPoint(entryPoint, range);
        } else {
            let node = new EntryPointNode(uri, range);
            node.addEntryPoint(entryPoint, range);
            this.entryPoints.set(uri, node);
        }
    }

    public clearEntryPoints(uri: vscode.Uri): void {
        this.entryPoints.get(uri)?.clearEntryPoints();
    }
    public delete(uri: vscode.Uri): void {
        this.entryPoints.delete(uri);
    }
    async documentSymbolProvider(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) : Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | null | undefined> {
        let asyncResult = next(document, token);
        if (asyncResult) {
            let result = await asyncResult;
            if (result) {
                // /!\ Type casting need to match server data sent. /!\ 
                let resultArray = result as vscode.SymbolInformation[];
                // Clear after async
                this.clearEntryPoints(document.uri);
                for (let symbol of resultArray) {
                    // Should not be an intrinsic as its only local symbol here.
                    if (symbol.kind === vscode.SymbolKind.Function) {
                        // Found a possible entry point.
                        this.addEntryPoint(document.uri, symbol.location.range, symbol.name + "(...)");
                    }
                }
                this.refresh();
                return result;
            }
            return result;
        }
        return asyncResult;
    }
}
