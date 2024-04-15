
import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLSymbolProvider implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {
    linter: Linter;

    constructor(linter: Linter) {
        this.linter = linter;
    }

    trimText(text: string, limit: number): string {
        if(text.length >= limit) {
            return text.substring(0, limit).concat('...');
        } else {
            return text;
        }
    }
    
    provideDocumentSymbols(
        document: vscode.TextDocument, 
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]>
    {
        return null;
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {
                //let regex = new RegExp(`\\b${word}\\b`, "i"); 
                const regex = /^\s*(public|export|global)\s+(constant|enum)\s+(\w+)\s+=\s+(.+)$/;
                // Should instead call a wasm backend in rust giving back reflection info.
                let symbols: vscode.DocumentSymbol[] = [];
                for (var i = 0; i < document.lineCount; i++) {
                    let line = document.lineAt(i);

                    let match = regex.exec(line.text) || [];
                    if (line) {
                        symbols.push(new vscode.DocumentSymbol(
                            match[1],
                            "float",
                            vscode.SymbolKind.Constant,
                            line.range,
                            line.range
                        ));
                    }
                }
                res(symbols);
            } else {
                rej();
            }
        });
    }
    
    provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]>
    {
        return new Promise((res, rej) => {
            rej();
        });
    }
    /*resolveWorkspaceSymbol?(symbol: T, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation>
    {
        return new Promise((res, rej) => {
            rej();
        });
    }*/
}