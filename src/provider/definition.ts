import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLDefinitionProvider implements vscode.DefinitionProvider {
    linter: Linter;

    constructor(linter: Linter) {
        this.linter = linter;
    }
    
    provideDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
        ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]>
    {
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {
                let results: vscode.Location[] = [];

                let range = document.getWordRangeAtPosition(position);
                let word = document.getText(range);

                let text = document.getText();
                let regex = new RegExp(`\\b${word}\\b`, "i"); 
                // Stop on first match for now. 
                // Should look for definition instead using a regex for function call. 
                // Should also search all folders in workspace if not found ?
                //vscode.workspace.findFiles("**/*.hlsl");
                let match = regex.exec(text);
                if (match) {
                    let pos = document.positionAt(match.index);
                    let range = document.getWordRangeAtPosition(pos);
                    if (range) {
                        results.push(new vscode.Location(document.uri, range));
                    }
                }

                res(results);
            } else {
                rej();
            }
        });
    }
}