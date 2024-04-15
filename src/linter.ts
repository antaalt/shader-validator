import * as vscode from 'vscode';

export class Linter {
    constructor() {

    }

    lint(
        document: vscode.TextDocument,
        diagCol: vscode.DiagnosticCollection
    ) {
        return null;
        return new Promise<void>((resolve, reject) => {
            // Read executable & parse its output.
        });
    }
}