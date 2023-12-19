import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLDefinitionProvider implements vscode.DefinitionProvider {
    linter: Linter;
    items: { [key: string]: vscode.Definition | vscode.LocationLink[] };

    constructor(linter: Linter) {
        this.linter = linter;
        this.items = {};
    }
    
    provideDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
        ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]>
    {
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {

                const c = new vscode.Location(
                    vscode.Uri.file("yo"), 
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