import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate } from './utils';

suite('Diagnostic Test Suite', () => {
	vscode.window.showInformationMessage('Start all diagnostics tests.');
	suiteTeardown(() => {
		vscode.window.showInformationMessage('All diagnostics tests done!');
	});
	if (process.platform === 'win32') {
		test('Diagnostic GLSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.frag.glsl");
			assert.ok(docUri.length > 0);
			await testDiagnostic(docUri[0], true);
		}).timeout(5000);

		test('Diagnostic HLSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.hlsl");
			assert.ok(docUri.length > 0);
			await testDiagnostic(docUri[0], false);
		}).timeout(5000);

		test('Diagnostic WGSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.wgsl");
			assert.ok(docUri.length > 0);
			await testDiagnostic(docUri[0], false);
		}).timeout(5000);
	}
});

async function testDiagnostic(
	docUri: vscode.Uri,
	waitServer: boolean
  ) {
	let data = await activate(docUri, waitServer)!;
    let diagnostics = vscode.languages.getDiagnostics(docUri);
    assert.ok(diagnostics.length === 0);
}
