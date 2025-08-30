// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createLanguageClient, getServerPlatform, ServerPlatform, ServerStatus, ShaderLanguageClient } from './validator';
import { dumpAstRequest, dumpDependencyRequest } from './request';
import { ShaderVariantTreeDataProvider } from './shaderVariant';
import { DidChangeConfigurationNotification, LanguageClient, Trace } from 'vscode-languageclient';
import { ShaderStatusBar } from './view/shaderStatusBar';

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
    const server = new ShaderLanguageClient(context);
    context.subscriptions.push(server);
    const serverStatus = await server.start(context);

    // Create sidebar
    sidebar = new ShaderVariantTreeDataProvider(context, server);
    context.subscriptions.push(sidebar);

    // Create status bar
    let statusBar = new ShaderStatusBar(context, server);
    context.subscriptions.push(statusBar);

    // Subscribe commands
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.validateFile", (uri: vscode.Uri) => {
        //client.sendRequest()
        vscode.window.showInformationMessage("Cannot validate file manually for now");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.startServer", async () => {
        await server.start(context);
        statusBar.updateStatusBar();
        sidebar.onServerStart();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.stopServer", async () => {
        await server.stop();
        statusBar.updateStatusBar();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.restartServer", async () => {
        await server.restart(context);
        statusBar.updateStatusBar();
        sidebar.onServerStart();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.showLogs", () => {
        const level = ShaderLanguageClient.getTraceLevel();
        if (level === Trace.Off) {
            vscode.window.showWarningMessage("Server trace is set to off. Set setting shader-validator.trace.server to messages or verbose to view logs.");
        } else {
            server.showLogs();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpAst", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && ShaderLanguageClient.isSupportedLangId(activeTextEditor.document.languageId)) {
            if (server.getServerStatus() === ServerStatus.running) {
                server.sendRequest(dumpAstRequest, {
                    uri: server.uriAsString(activeTextEditor.document.uri)
                }).then((value: string | null) => {
                    console.info(value);
                    if (value) {
                        server.log(value);
                        server.showLogs();
                    } else {
                        server.log("No AST to dump");
                    }
                }, (reason: any) => {
                    server.log("Failed to get ast: " + reason);
                });
            } else {
                vscode.window.showWarningMessage("Server is not running");
            }
        } else {
            server.log("No active file for dumping ast");
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpDependency", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && ShaderLanguageClient.isSupportedLangId(activeTextEditor.document.languageId)) {
            if (server.getServerStatus() === ServerStatus.running) {
                server.sendRequest(dumpDependencyRequest, {
                    uri: server.uriAsString(activeTextEditor.document.uri)
                }).then((value: string | null) => {
                    console.info(value);
                    if (value) {
                        server.log(value);
                        server.showLogs();
                    } else {
                        server.log("No deps tree to dump");
                    }
                }, (reason: any) => {
                    server.log("Failed to get deps tree: " + reason);
                });
            } else {
                vscode.window.showWarningMessage("Server is not running");
            }
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