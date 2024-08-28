import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate } from './utils';

suite('Completion Test Suite', () => {
	vscode.window.showInformationMessage('Start all completion tests.');
	suiteTeardown(() => {
		vscode.window.showInformationMessage('All completion tests done!');
	});

    if (process.platform === 'win32') {
		test('Complete GLSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.frag.glsl");
			assert.ok(docUri.length > 0);
			await testCompletion(docUri[0], new vscode.Position(0, 0), {
				items: [
					{ label: 'clamp', kind: vscode.CompletionItemKind.Function },
					{ label: 'main', kind: vscode.CompletionItemKind.Function },
					{ label: 'test', kind: vscode.CompletionItemKind.Function },
					{ label: 'res', kind: vscode.CompletionItemKind.Variable },
				]
			}, true);
		}).timeout(5000);

		test('Complete HLSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.hlsl");
			assert.ok(docUri.length > 0);
			await testCompletion(docUri[0], new vscode.Position(0, 0), {
				items: []
			}, false);
		}).timeout(5000);

		test('Complete WGSL code', async () => {
			const docUri = await vscode.workspace.findFiles("test.wgsl");
			assert.ok(docUri.length > 0);
			await testCompletion(docUri[0], new vscode.Position(0, 0), {
				items: []
			}, false);
		}).timeout(5000);
	}
});

async function testCompletion(
	docUri: vscode.Uri,
	position: vscode.Position,
	expectedCompletionList: vscode.CompletionList,
	waitServer: boolean
  ) {
	let data = await activate(docUri, waitServer)!;
  
	// Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
	const actualCompletionList = (await vscode.commands.executeCommand(
		'vscode.executeCompletionItemProvider',
		docUri,
		position
	)) as vscode.CompletionList;
	assert.ok(actualCompletionList.items.length >= expectedCompletionList.items.length);
	expectedCompletionList.items.forEach((expectedItem : vscode.CompletionItem) => {
		// Look into database if we can find them
		let item = actualCompletionList.items.find((actualItem) => {
			//const actualItem = actualCompletionList.items[i];
			const actualLabel = actualItem.label as vscode.CompletionItemLabel;
			return actualLabel.label === expectedItem.label && actualItem.kind === expectedItem.kind;
		});
		assert.notStrictEqual(item, undefined, `Failed to find symbol ${expectedItem.label}`);
	});
}
