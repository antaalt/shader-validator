import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLHoverProvider implements vscode.HoverProvider {
    linter: Linter;
    items: { [key: string]: vscode.Hover };

    constructor(linter: Linter) {
        this.linter = linter;
        this.items = {};
    }
    
    provideHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
        ): vscode.ProviderResult<vscode.Hover>
    {
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {
                
                const c = new vscode.Hover(
                    "yo", 
                    new vscode.Range(
                        new vscode.Position(0, 10), 
                        new vscode.Position(10, 10),
                    )
                );
                this.items[document.uri.toString()] = c;

                res(this.items[document.uri.toString()]);
            } else {
                rej();
            }
        });
    }
}