import * as vscode from "vscode";
import { Linter } from "../linter";

export class HLSLCompletionItemProvider implements vscode.CompletionItemProvider {
    linter: Linter;
    items: { [key: string]: vscode.CompletionItem[] };

    constructor(linter: Linter) {
        this.linter = linter;
        this.items = {};
    }
    
    provideCompletionItems(
        document: vscode.TextDocument,
        _position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
      ): vscode.ProviderResult<any[] | vscode.CompletionList<vscode.CompletionItem>> {
        return new Promise((res, rej) => {
            if (document.languageId === "hlsl") {
                const out: vscode.CompletionItem[] = [];

                const c = new vscode.CompletionItem("yo");
                c.kind = vscode.CompletionItemKind.Variable;
                out.push(c);

                res(this.items[document.uri.toString()]);
            } else {
                rej();
            }
        });
      };
}