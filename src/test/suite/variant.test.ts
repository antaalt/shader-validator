import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate, openAndShowFile, testDiagnostic, testHasDocumentSymbol } from './utils';

suite('Server variant Test Suite', () => {
    vscode.window.showInformationMessage('Start all variant tests.');
    suiteTeardown(async () => {
        // Remove variant for next test.
        await vscode.commands.executeCommand(
            'shader-validator.disableActiveShaderVariant'
        );
        vscode.window.showInformationMessage('All variant tests done!');
    });
    test('Check variant config', async () => {
        const docUri = await vscode.workspace.findFiles("test.variant.hlsl");
        assert.ok(docUri.length > 0);
        await activate()!;
        // Load database
        const configUri = await vscode.workspace.findFiles("variant.config.json");
        await vscode.commands.executeCommand("shader-validator.loadVariantDatabaseFromUri", configUri[0]);
        // Validate file
        await openAndShowFile(docUri[0]);
        await testDiagnostic(docUri[0], false);
        await testHasDocumentSymbol(docUri[0], "mainOk");
    }).timeout(10000); // First test to run that start the server. Increase timeout to be sure its not timed out.
});
