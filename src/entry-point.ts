import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

class EntryPointNode extends vscode.TreeItem {
    children: EntryPointNode[]|undefined;
  
    constructor(uri: vscode.Uri, entryPoint? : string) {
        let isEntryPoint = entryPoint ? true : false;
        super(
            entryPoint || uri.fsPath,
            isEntryPoint ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded
        );
        this.command = {
            title: "Set current entry point",
            command: "shader-validator.setCurrentEntryPoint",
            arguments: []
        }
        this.children = [];
    }
    isEntryPoint() : boolean {
        return this.collapsibleState === vscode.TreeItemCollapsibleState.None;
    }
    addEntryPoint(entryPoint: string) {
        this.children?.push(new EntryPointNode(this.resourceUri!, entryPoint));
    }
    clearEntryPoints() {
        this.children = [];
    }
}
export class EntryPointTreeDataProvider implements vscode.TreeDataProvider<EntryPointNode> {

    private _onDidChangeTreeData: vscode.EventEmitter<EntryPointNode | undefined | void> = new vscode.EventEmitter<EntryPointNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPointNode | undefined | void> = this._onDidChangeTreeData.event;
    
    // Array or map ?
    private entryPoints : Map<vscode.Uri, EntryPointNode> = new Map;

    
    constructor() {
    }

    public refresh() {
        this._onDidChangeTreeData.fire();
    }


    public getTreeItem(element: EntryPointNode): vscode.TreeItem {
        console.info("Get item", element);
        return element;
    }

    public getChildren(element?: EntryPointNode): EntryPointNode[] | Thenable<EntryPointNode[]> {
        if (element) {
            return element.children || [];
        } else {
            return Array.from(this.entryPoints.values());
        }
    }

    public addEntryPoint(uri: vscode.Uri, entryPoint: string): void {
        console.info(`Adding possible entry point for file ${uri}: ${entryPoint}`);
        
        let file = this.entryPoints.get(uri);
        if (file) {
            file.addEntryPoint(entryPoint);
        } else {
            let node = new EntryPointNode(uri);
            node.addEntryPoint(entryPoint);
            this.entryPoints.set(uri, node);
        }
    }

    public clearEntryPoints(uri: vscode.Uri): void {
        this.entryPoints.get(uri)?.clearEntryPoints();
    }
    async documentSymbolProvider(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) : Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | null | undefined> {
        let asyncResult = next(document, token);
        this.clearEntryPoints(document.uri);
        if (asyncResult) {
            let result = await asyncResult;
            if (result) {
                // /!\ Type casting need to match server data sent. /!\ 
                let resultArray = result as vscode.SymbolInformation[];
                for (let symbol of resultArray) {
                    // TODO: check not an intrinsic aswell.
                    // Should not be as its only local symbol here.
                    if (symbol.kind === vscode.SymbolKind.Function) {
                        // Found a possible entry point.
                        this.addEntryPoint(document.uri, symbol.name);
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
