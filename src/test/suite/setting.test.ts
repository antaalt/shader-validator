import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { activate, sleep } from './utils';

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
            await activate(docUri[0], true)!;
            // main is guarded by INCLUDED_MACRO (coming from the remapped include) & SETTINGS_MACRO (coming from defines),
            // so it is only visible if the settings made their way to the server.
            await updateSettings();
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
    // Sleeping does not seems to trigger a config update, so restart the server to be sure its valid.
    await vscode.commands.executeCommand('shader-validator.restartServer');
}

async function resetSettings() {
    const config = vscode.workspace.getConfiguration("shader-validator");
    for (const [key, _value] of settings) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
}

async function testDiagnostic(
    docUri: vscode.Uri
  ) {
    let diagnostics = vscode.languages.getDiagnostics(docUri);
    assert.ok(diagnostics.length === 0, "Diagnostic is not empty: " + JSON.stringify(diagnostics));
}

async function testDocumentSymbol(
    docUri: vscode.Uri,
    expectedSymbol: string
  ) {
    // /!\ Type casting need to match server data sent. /!\
    const symbols = (await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        docUri
    )) as vscode.DocumentSymbol[] | undefined;
    assert.ok(symbols, "No document symbol returned for " + docUri.fsPath);
    const symbolNames = symbols.map((symbol) => symbol.name);
    assert.ok(
        symbolNames.includes(expectedSymbol),
        `Failed to find symbol ${expectedSymbol} in ${JSON.stringify(symbolNames)}`
    );
}
