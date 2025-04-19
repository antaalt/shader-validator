import * as vscode from 'vscode';
import * as fs from 'fs';
import * as tmp from 'tmp';
import { DocumentSelector } from 'vscode-languageclient';

export class HLSLFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
    static selector: DocumentSelector = [{ scheme: 'file', language: 'hlsl' }, { language: 'hlsl', scheme: 'untitled' }];
    async provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]>
    {
        const tmpFile = tmp.fileSync({ prefix: 'hlsl-', postfix: '.cpp' });
        try {
            fs.writeFileSync(tmpFile.name, document.getText());
            const doc = await vscode.workspace.openTextDocument(tmpFile.name);
            const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', doc.uri, options);
            return edits || [];
        } finally {
            tmpFile.removeCallback();
        }
    }

    async provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]>
    {
        const tmpFile = tmp.fileSync({ prefix: 'hlsl-', postfix: '.cpp' });
        try {
            fs.writeFileSync(tmpFile.name, document.getText());
            const doc = await vscode.workspace.openTextDocument(tmpFile.name);
            const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatRangeProvider', doc.uri, range, options);
            return edits || [];
        } finally {
            tmpFile.removeCallback();
        }
    }
}