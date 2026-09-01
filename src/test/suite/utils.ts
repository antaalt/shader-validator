import * as vscode from 'vscode';
import * as path from 'path';
import assert from 'assert';
import { isRunningOnWeb } from '../../client';

export function getRootFolder() : string {
	// Depending on platform, we have different cwd...
	// https://github.com/microsoft/vscode-test/issues/17
	return path.join(process.cwd(), process.platform === 'win32' ? "../../" : "./");
}

// On the web there is no native server, so wasi is always used whatever the setting.
export function isUsingWasiServer() : boolean {
	return isRunningOnWeb() || process.env.USE_WASI_SERVER === "true";
}

export async function activate(waitServer: boolean) : Promise<void> {
	const ext = vscode.extensions.getExtension('antaalt.shader-validator')!;
    if (!ext.isActive) {
        // Here set the settings to get the correct server to test.
        const useWasiServer = isUsingWasiServer();
        await vscode.workspace.getConfiguration("shader-validator").update("useWasiServer", useWasiServer, vscode.ConfigurationTarget.Global);
        console.info(`Activating ${useWasiServer ? "wasi" : "native"} server for test`);

        // Trace is required for the server output channel to exist & for RUST_LOG to be set.
        // The extension mirrors that channel to the console when running tests, so it lands in the terminal.
        // /!\ Must be set before the first activation, as changing it later restarts the server. /!\
        const showServerLogs = true;//process.env.SHOW_SERVER_LOGS === "true";
        await vscode.workspace.getConfiguration("shader-validator").update("trace.server", showServerLogs ? "messages" : "off", vscode.ConfigurationTarget.Global);

        // Now activate extension with settings
        await ext.activate();
        if (waitServer) {
            await sleep(2000); // Wait for server activation
        }
    }
}

export async function openAndShowFile(docUri: vscode.Uri) : Promise<[vscode.TextDocument, vscode.TextEditor]> {
	let doc = await vscode.workspace.openTextDocument(docUri);
	let editor = await vscode.window.showTextDocument(doc);
	return [doc, editor];
}

export async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function testDiagnostic(
    docUri: vscode.Uri,
	hasAny: boolean
  ) {
    let diagnostics = vscode.languages.getDiagnostics(docUri);
    assert.ok((diagnostics.length === 0) && !hasAny, `Diagnostic is ${hasAny ? 'empty' : 'not empty'}: ${JSON.stringify(diagnostics)}`);
}

export async function testDocumentSymbol(
    docUri: vscode.Uri,
    hasAny: boolean,
  ) {
    // /!\ Type casting need to match server data sent. /!\
    const symbols = (await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        docUri
    )) as vscode.DocumentSymbol[] | undefined;
    assert.ok(((symbols && symbols.length === 0) || symbols === undefined) && !hasAny, `Symbols are ${hasAny ? 'empty' : 'not empty'}: ${JSON.stringify(symbols)}`);
}

export async function testHasDocumentSymbol(
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