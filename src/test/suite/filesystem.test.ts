import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate, openAndShowFile, testDiagnostic } from './utils';

suite('Filesystem Test Suite', () => {
    vscode.window.showInformationMessage('Start all filesystem tests.');
    suiteTeardown(() => {
        vscode.window.showInformationMessage('All filesystem tests done!');
    });
    test('Test unsaved file opening', async () => {
        await activate()!;
        const doc = await vscode.workspace.openTextDocument({
            language: 'glsl',
            content: '#version 450\nvoid main() {}'
        });
        let diagnostics = vscode.languages.getDiagnostics(doc.uri);
        assert.ok(diagnostics.length === 0, `Diagnostic is not empty: ${JSON.stringify(diagnostics)}`);
    }).timeout(5000);
});
