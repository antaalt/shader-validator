import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate } from './utils';

suite('Server variant Test Suite', () => {
    test('Check variant config', async () => {
        const docUri = await vscode.workspace.findFiles("test.variant.hlsl");
        assert.ok(docUri.length > 0);
        let data = await activate(docUri[0], true)!;
        // Load database
        const configUri = await vscode.workspace.findFiles("variant.config.json");
        await vscode.commands.executeCommand("shader-validator.loadVariantDatabase", configUri[0]);
        // Check no diagnostics
        let diagnostics = vscode.languages.getDiagnostics(docUri[0]);
        assert.ok(diagnostics.length === 0, "Diagnostic is not empty: " + JSON.stringify(diagnostics));
    }).timeout(10000); // First test to run that start the server. Increase timeout to be sure its not timed out.
});
