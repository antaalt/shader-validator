import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate, openAndShowFile, sleep, testDiagnostic, testDocumentSymbol } from './utils';

// Settings required by test.settings.hlsl to resolve its include & enter its preprocessor branches.
// They rely on vscode variables aswell to ensure they are correctly resolved before being sent to the server.
const SETTINGS_MACRO: [string, any][] = [
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
            await resetSettings(SETTINGS_MACRO);
        });
        suiteTeardown(async () => {
            // Runs even when the test fails, unlike a reset at the end of the test body.
            await resetSettings(SETTINGS_MACRO);
            vscode.window.showInformationMessage('All settings tests done!');
        });
        test('Test symbols with settings', async () => {
            const docUri = await vscode.workspace.findFiles("test.settings.hlsl");
            assert.ok(docUri.length > 0);
            await activate(true);
            await updateSettings(SETTINGS_MACRO);
            await openAndShowFile(docUri[0]);
            await testDiagnostic(docUri[0]);
            await testDocumentSymbol(docUri[0], "main");
        }).timeout(30000);
    }
});

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
