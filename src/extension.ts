// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createLanguageClient, getServerPlatform, ServerPlatform } from './validator';
import { dumpAstRequest } from './request';
import { ShaderVariantTreeDataProvider } from './shaderVariant';

export let sidebar: ShaderVariantTreeDataProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
    // Install dependencies if running on wasi
    const msWasmWasiCoreName = 'ms-vscode.wasm-wasi-core';
    const msWasmWasiCore = vscode.extensions.getExtension(msWasmWasiCoreName);
    if (msWasmWasiCore === undefined && getServerPlatform() === ServerPlatform.wasi) 
    {
        const message = 'It is required to install Microsoft WASM WASI core extension for running the shader validator server on wasi. Do you want to install it now?';
        const choice = await vscode.window.showInformationMessage(message, 'Install', 'Not now');
        if (choice === 'Install') {
            // Wait for extension to be correctly installed.
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification },
                (progress) => {
                    progress.report({ message: "Installing Microsoft WASM wasi core extension" });
                    return new Promise<void>((resolve, reject) => {
                        vscode.extensions.onDidChange((e) => {
                            console.assert(vscode.extensions.getExtension(msWasmWasiCoreName) !== undefined, "Failed to load WASM wasi core.");
                            resolve();
                        });
                        vscode.commands.executeCommand("workbench.extensions.installExtension", msWasmWasiCoreName);
                    });
                },
            );
        } else {
            vscode.window.showErrorMessage("Extension shader-validator failed to install dependencies. It will not launch the validation server.");
            return; // Extension failed to launch.
        }
    }

    // Create language client
    const client = await createLanguageClient(context);
    if (client === null) {
        vscode.window.showErrorMessage("Failed to launch shader-validator language server.");
        return;
    }

    // Create sidebar
    sidebar = new ShaderVariantTreeDataProvider(context, client);

    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(client));

    // Subscribe commands
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.validateFile", (uri: vscode.Uri) => {
        //client.sendRequest()
        vscode.window.showInformationMessage("Cannot validate file manually for now");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpAst", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor) {            
            client.sendRequest(dumpAstRequest, {
                uri: client.code2ProtocolConverter.asUri(activeTextEditor.document.uri)
            }).then((value: string | null) => {
                console.info(value);
                client.outputChannel.appendLine(value || "No AST to dump");
            }, (reason: any) => {
                client.outputChannel.appendLine("Failed to get ast: " + reason);
            });
        } else {
            client.outputChannel.appendLine("No active file for dumping ast");
        }
    }));
}


// This method is called when your extension is deactivated
export function deactivate(context: vscode.ExtensionContext) {
    // Validator should self destruct thanks to vscode.Disposable
}