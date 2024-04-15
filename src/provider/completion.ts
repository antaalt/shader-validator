import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLCompletionItemProvider implements vscode.CompletionItemProvider {
    linter: Linter;

    constructor(linter: Linter) {
        this.linter = linter;
    }
    
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
      ): vscode.ProviderResult<any[] | vscode.CompletionList<vscode.CompletionItem>> {
        return null;
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {

                let range = document.getWordRangeAtPosition(position);
                let word = document.getText(range);

                // TODO: Hit the db & find a matching element close.

                const out: vscode.CompletionItem[] = [];
                const c = new vscode.CompletionItem(word + "test-test");
                c.kind = vscode.CompletionItemKind.Variable;
                out.push(c);

                res(out);
            } else {
                rej();
            }
        });
      };
}