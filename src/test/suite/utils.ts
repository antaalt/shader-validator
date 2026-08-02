import * as vscode from 'vscode';
import * as path from 'path';

export function getRootFolder() : string {
	// Depending on platform, we have different cwd...
	// https://github.com/microsoft/vscode-test/issues/17
	return path.join(process.cwd(), process.platform === 'win32' ? "../../" : "./");
}

export async function activate(docUri: vscode.Uri, waitServer: boolean) : Promise<[vscode.TextDocument, vscode.TextEditor] | null> {
	const ext = vscode.extensions.getExtension('antaalt.shader-validator')!;

	// Here set the settings to get the correct server to test.
	const useWasiServer = process.env.USE_WASI_SERVER === "true";
	await vscode.workspace.getConfiguration("shader-validator").update("useWasiServer", useWasiServer, vscode.ConfigurationTarget.Global);
	console.info(`Activating ${useWasiServer ? "wasi" : "native"} server for test`);

	// Trace is required for the server output channel to exist & for RUST_LOG to be set.
	// The extension mirrors that channel to the console when running tests, so it lands in the terminal.
	// /!\ Must be set before the first activation, as changing it later restarts the server. /!\
	const showServerLogs = process.env.SHOW_SERVER_LOGS === "true";
	await vscode.workspace.getConfiguration("shader-validator").update("trace.server", showServerLogs ? "messages" : "off", vscode.ConfigurationTarget.Global);

	// Now activate extension with settings
	await ext.activate();
	try {
		let doc = await vscode.workspace.openTextDocument(docUri);
		let editor = await vscode.window.showTextDocument(doc);
        if (waitServer) {
		    await sleep(2000); // Wait for server activation
        }
		return [doc, editor];
	} catch (e) {
		console.error(e);
		return null;
	}
}

export async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}