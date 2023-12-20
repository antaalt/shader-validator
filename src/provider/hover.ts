import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLHoverProvider implements vscode.HoverProvider {
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
    
    provideHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
        ): vscode.ProviderResult<vscode.Hover>
    {
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {
                // TODO: should search in a db language specific informations about current function. 
                // If nothing, regex to look for definition if function. if variable aswell.
                let range = document.getWordRangeAtPosition(position);
                let name = document.getText(range);
                const c = new vscode.Hover(
                    "You are currently hovering the text '" + this.trimText(name, 15) + "'. Do what you want with this information.", 
                    range
                );

                res(c);
            } else {
                rej();
            }
        });
    }
}