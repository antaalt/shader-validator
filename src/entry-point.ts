import * as vscode from 'vscode';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

class EntryPointNode extends vscode.TreeItem {
    children: EntryPointNode[] | undefined;
  
    constructor(uri: vscode.Uri, range?: vscode.Range, entryPoint? : string) {
        const isEntryPointString = entryPoint ? true : false;
        const isEntryPointRange = range ? true : false;
        const isEntryPoint = isEntryPointRange && isEntryPointString;
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
    add(entryPoint: string, range: vscode.Range) {
        this.children?.push(new EntryPointNode(this.resourceUri!, range, entryPoint));
    }
    clear() {
        this.children = [];
    }
    visit(callback: (entryPoint: string, range: vscode.Range, active: boolean) => void) {
        const range = (this.command?.arguments!)[1] as vscode.TextDocumentShowOptions;
        const active = this.checkboxState === vscode.TreeItemCheckboxState.Checked;
        callback(this.label as string, range.selection!, active);
    }
}
export class EntryPointTreeDataProvider implements vscode.TreeDataProvider<EntryPointNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<EntryPointNode | undefined | void> = new vscode.EventEmitter<EntryPointNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EntryPointNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;
    
    // Array or map ?
    private entryPoints : Map<vscode.Uri, EntryPointNode> = new Map;

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
            file.add(entryPoint, range);
        } else {
            let node = new EntryPointNode(uri, range);
            node.add(entryPoint, range);
            this.entryPoints.set(uri, node);
        }
    }

    public clearEntryPoint(uri: vscode.Uri): void {
        this.entryPoints.get(uri)?.clear();
    }
    public addFile(uri: vscode.Uri): void {
        this.entryPoints.set(uri, new EntryPointNode(uri));
        this.refresh();
    }
    public deleteFile(uri: vscode.Uri): void {
        this.entryPoints.delete(uri);
        this.refresh();
    }
    public visitEntryPoints(uri: vscode.Uri, callback: (e:string, r: vscode.Range, active: boolean) => void) {
        this.entryPoints.get(uri)?.children?.map(entryPoint => {
            entryPoint.visit(callback);
        });
    }
    async documentSymbolProvider(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) : Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | null | undefined> {
        let asyncResult = next(document, token);
        if (asyncResult) {
            let result = await asyncResult;
            if (result) {
                // /!\ Type casting need to match server data sent. /!\ 
                let resultArray = result as vscode.SymbolInformation[];
                // Clear after async
                this.clearEntryPoint(document.uri);
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
