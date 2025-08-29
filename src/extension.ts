// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createLanguageClient, getServerPlatform, ServerPlatform, ShaderLanguageClient } from './validator';
import { dumpAstRequest, dumpDependencyRequest } from './request';
import { ShaderVariantTreeDataProvider } from './shaderVariant';
import { DidChangeConfigurationNotification, LanguageClient } from 'vscode-languageclient';

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
            vscode.window.showErrorMessage("Extension shader-validator failed to install dependencies. It will not launch the shader language server.");
            return; // Extension failed to launch.
        }
    }

    // Create language client
    const server = new ShaderLanguageClient;
    context.subscriptions.push(server);
    const isInitialized = await server.start(context);
    if (!isInitialized) {
        console.error("Failed to launch shader-validator language server.");
        return;
    }
    let supportedLangId = ["hlsl", "glsl", "wgsl"];

    // Create sidebar
    sidebar = new ShaderVariantTreeDataProvider(context, server);

    // Subscribe commands
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.validateFile", (uri: vscode.Uri) => {
        //client.sendRequest()
        vscode.window.showInformationMessage("Cannot validate file manually for now");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.restartServer", (uri: vscode.Uri) => {
        server.restart(context);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpAst", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && supportedLangId.includes(activeTextEditor.document.languageId)) {            
            server.sendRequest(dumpAstRequest, {
                uri: server.uriAsString(activeTextEditor.document.uri)
            }).then((value: string | null) => {
                console.info(value);
                server.log(value || "No AST to dump");
            }, (reason: any) => {
                server.log("Failed to get ast: " + reason);
            });
        } else {
            server.log("No active file for dumping ast");
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpDependency", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && supportedLangId.includes(activeTextEditor.document.languageId)) {            
            server.sendRequest(dumpDependencyRequest, {
                uri: server.uriAsString(activeTextEditor.document.uri)
            }).then((value: string | null) => {
                console.info(value);
                server.log(value || "No deps tree to dump");
            }, (reason: any) => {
                server.log("Failed to get deps tree: " + reason);
            });
        } else {
            server.log("No active file for dumping deps tree");
        }
    }));
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event : vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration("shader-validator")) {
                if (event.affectsConfiguration("shader-validator.trace.server") || 
                    event.affectsConfiguration("shader-validator.serverPath")) {
                    server.restart(context);
                } else {
                    await server.sendNotification(DidChangeConfigurationNotification.type, {
                        settings: "",
                    });
                }
            }
        })
    );
}


// This method is called when your extension is deactivated
export function deactivate(context: vscode.ExtensionContext) {
    // Validator should self destruct thanks to vscode.Disposable
}