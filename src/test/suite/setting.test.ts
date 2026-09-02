import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate, isUsingWasiServer, openAndShowFile, sleep, testDiagnostic, testDocumentSymbol, testHasDocumentSymbol } from './utils';

// Settings required by test.settings.hlsl to resolve its include & enter its preprocessor branches.
// They rely on vscode variables aswell to ensure they are correctly resolved before being sent to the server.
const SETTINGS_GENERIC_HLSL: [string, any][] = [
    ["includes", ["${workspaceFolder}/includes"]],
    ["defines", { "SETTINGS_MACRO": "1" }], // eslint-disable-line @typescript-eslint/naming-convention
    ["pathRemapping", { "/Header": "${workspaceFolder}/includes" }], // eslint-disable-line @typescript-eslint/naming-convention
    ["hlsl.enable16bitTypes", true],
    ["hlsl.spirv", true],
    ["hlsl.shaderModel", "ShaderModel6_8"],
    ["hlsl.version", "V2021"],
];

const SETTINGS_GLSL: [string, any][] = [
    ["glsl.spirvVersion", "SPIRV1_6"],
    ["glsl.targetClient", "Vulkan1_3"],
    ["glsl.preamble", "${workspaceFolder}/includes/preamble.glsl"],
];

const SETTINGS_VALIDATION: [string, any][] = [
    ["validate", false],
    ["symbols", false],
];

suite('Settings Test Suite', () => {
	const useWasiServer = isUsingWasiServer();
    vscode.window.showInformationMessage('Start all settings tests.');
    suiteTeardown(async () => {
        // Reset settings here as failure might miss resetting them.
        await resetSettings(SETTINGS_VALIDATION);
        await resetSettings(SETTINGS_GENERIC_HLSL);
        await resetSettings(SETTINGS_GLSL);
        vscode.window.showInformationMessage('All settings tests done!');
    });
    test('Test HLSL and generic settings', async () => {
        // Skip test on WASI as we use DXC and HLSL.
        if (!useWasiServer) {
            const docUri = await vscode.workspace.findFiles("test.settings.hlsl");
            assert.ok(docUri.length > 0);
            await activate();
            await updateSettings(SETTINGS_GENERIC_HLSL);
            await openAndShowFile(docUri[0]);
            await testDiagnostic(docUri[0], false);
            await testHasDocumentSymbol(docUri[0], "main");
            await resetSettings(SETTINGS_GENERIC_HLSL);
        }
    }).timeout(10000);

    test('Test validation settings', async () => {
        // Skip test on WASI as we use DXC and HLSL.
        if (!useWasiServer) {
            const docUri = await vscode.workspace.findFiles("test.settings.hlsl");
            assert.ok(docUri.length > 0);
            await activate();
            await updateSettings(SETTINGS_VALIDATION);
            let [doc, _editor] = await openAndShowFile(docUri[0]);
            // Touch document to retrigger cache as we use same file as previous test.
            await touchDocument(doc);
            await testDiagnostic(docUri[0], false);
            await testDocumentSymbol(docUri[0], false);
            await resetSettings(SETTINGS_VALIDATION);
        }
    }).timeout(10000);

    test('Test GLSL settings', async () => {
        // TODO: This should work on WASI, but for now, preamble path fail to resolve workspaceFolder, so it does not load and compilation generate badalloc on glslang validation
        if (!useWasiServer) {
            const docUri = await vscode.workspace.findFiles("test.settings.frag.glsl");
            assert.ok(docUri.length > 0);
            await activate();
            await updateSettings(SETTINGS_GLSL);
            let [doc, _editor] = await openAndShowFile(docUri[0]);
            // Touch document to retrigger cache as we use same file as previous test.
            await touchDocument(doc);
            await testDiagnostic(docUri[0], false);
            await testHasDocumentSymbol(docUri[0], "main");
            await resetSettings(SETTINGS_GLSL);
        }
    }).timeout(10000);
});

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

async function updateSettings(settings : [string, any][]) {
    const config = vscode.workspace.getConfiguration("shader-validator");
    for (const [key, value] of settings) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
}

async function resetSettings(settings : [string, any][]) {
    const config = vscode.workspace.getConfiguration("shader-validator");
    for (const [key, _value] of settings) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
}
