import * as vscode from 'vscode';
import * as path from 'path';

export function getRootFolder() : string {
	// Depending on platform, we have different cwd...
	// https://github.com/microsoft/vscode-test/issues/17
	return path.join(process.cwd(), process.platform === 'win32' ? "../../" : "./");
}

export async function activate(docUri: vscode.Uri, waitServer: boolean) : Promise<[vscode.TextDocument, vscode.TextEditor] | null> {
	const ext = vscode.extensions.getExtension('antaalt.shader-validator')!;
	// Here set the configuration if we are testing wasi. Read a command line argument, and enforce wasi server.
	const isTestingWasiServer = process.env.USE_WASI_SERVER === "true";
	if (isTestingWasiServer) {
		vscode.workspace.getConfiguration("shader-validator").update("useWasiServer", true);
		console.info("Activating wasi server for test");
	} else {
		console.info("Activating native server for test");
	}
	// Now activate extension
	await ext.activate();
	try {
		let doc = await vscode.workspace.openTextDocument(docUri);
		let editor = await vscode.window.showTextDocument(doc);
        if (waitServer) {
		    await sleep(1000); // Wait for server activation
        }
		return [doc, editor];
	} catch (e) {
		console.error(e);
		return null;
	}
}

async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}