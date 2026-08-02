import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate, sleep, testDiagnostic, testDocumentSymbol } from './utils';

// Settings required by test.settings.hlsl to resolve its include & enter its preprocessor branches.
// They rely on vscode variables aswell to ensure they are correctly resolved before being sent to the server.
const settings: [string, any][] = [
    ["includes", ["${workspaceFolder}/includes"]],
    ["defines", { "SETTINGS_MACRO": "1" }], // eslint-disable-line @typescript-eslint/naming-convention
    ["pathRemapping", { "/Header": "${workspaceFolder}/includes" }], // eslint-disable-line @typescript-eslint/naming-convention
];

suite('Settings Test Suite', () => {
	const useWasiServer = process.env.USE_WASI_SERVER === "true";
    // Skip test on WASI as we use DXC and HLSL.
    if (!useWasiServer) {
        vscode.window.showInformationMessage('Start all settings tests.');
        suiteSetup(async () => {
            // Clear to be sure we update settings correctly
            await resetSettings();
        });
        suiteTeardown(async () => {
            // Runs even when the test fails, unlike a reset at the end of the test body.
            await resetSettings();
            vscode.window.showInformationMessage('All settings tests done!');
        });
        test('Test symbols with settings', async () => {
            const docUri = await vscode.workspace.findFiles("test.settings.hlsl");
            assert.ok(docUri.length > 0);
            const opened = await activate(docUri[0], true);
            assert.ok(opened, "Failed to open " + docUri[0].fsPath);
            const [doc, _editor] = opened;
            // main is guarded by INCLUDED_MACRO (coming from the remapped include) & SETTINGS_MACRO (coming from defines),
            // so it is only visible if the settings made their way to the server.
            await updateSettings();
            await touchDocument(doc);
            await testDiagnostic(docUri[0]);
            await testDocumentSymbol(docUri[0], "main");
        }).timeout(30000);
    }
});

async function updateSettings() {
    const config = vscode.workspace.getConfiguration("shader-validator");
    for (const [key, value] of settings) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
}

// vscode caches document symbols (OutlineModel) per text document version & registered provider set.
// A save does not bump the version, and the server declares documentSymbol statically, so the provider
// set never changes either: after a configuration change, the outline stays stale until the document
// is edited. Applying an edit & reverting it bumps the version twice while leaving the content
// untouched, which invalidates the cache and lets the server answer with the new settings applied.
async function touchDocument(doc: vscode.TextDocument) {
    const end = doc.lineAt(doc.lineCount - 1).range.end;
    const insertion = new vscode.WorkspaceEdit();
    insertion.insert(doc.uri, end, "\n");
    assert.ok(await vscode.workspace.applyEdit(insertion), "Failed to edit " + doc.uri.fsPath);
    const deletion = new vscode.WorkspaceEdit();
    deletion.delete(doc.uri, new vscode.Range(end, doc.lineAt(doc.lineCount - 1).range.end));
    assert.ok(await vscode.workspace.applyEdit(deletion), "Failed to revert edit of " + doc.uri.fsPath);
    // Content is back to its original state, so this writes the exact same bytes & only serves to
    // leave the editor clean for the next tests.
    assert.ok(await doc.save(), "Failed to save " + doc.uri.fsPath);
    await sleep(1000); // Let the server handle the didChange notifications.
}

async function resetSettings() {
    const config = vscode.workspace.getConfiguration("shader-validator");
    for (const [key, _value] of settings) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
}
