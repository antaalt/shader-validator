// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ServerPlatform, ServerStatus, ShaderLanguageClient, ServerVersion } from './client';
import { dumpAstRequest, dumpDependencyRequest } from './request';
import { ShaderVariantTreeDataProvider } from './view/shaderVariantTreeView';
import { DidChangeConfigurationNotification, LanguageClient, Trace } from 'vscode-languageclient';
import { ShaderStatusBar } from './view/shaderStatusBar';

export let sidebar: ShaderVariantTreeDataProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
    // Install dependencies if running on wasi
    if (ServerVersion.getServerPlatform() === ServerPlatform.wasi) 
    {
        const msWasmWasiCoreName = 'ms-vscode.wasm-wasi-core';
        const msWasmWasiCore = vscode.extensions.getExtension(msWasmWasiCoreName);
        if (msWasmWasiCore === undefined)
        {
            const message = 'It is required to install Microsoft WASM WASI core extension for running the shader validator server on wasi. Do you want to install it now?';
            const choice = await vscode.window.showInformationMessage(message, 'Install', 'Not now');
            if (choice === 'Install') {
                // Wait for extension to be correctly installed.
                let installed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification },
                    (progress) => {
                        progress.report({ message: "Installing Microsoft WASM wasi core extension" });
                        return vscode.commands.executeCommand("workbench.extensions.installExtension", msWasmWasiCoreName);
                    },
                ).then(success => {
                    console.assert(vscode.extensions.getExtension(msWasmWasiCoreName) !== undefined, "Failed to load WASM wasi core.");
                    vscode.window.showInformationMessage("Microsoft WASM wasi core extension installed with success !");
                    return true;
                }, failure => {
                    console.error("Failed to install ms-vscode.wasm-wasi-core: ", failure);
                    vscode.window.showErrorMessage(`Failed to install Microsoft WASM wasi core. You will have to install ms-vscode.wasm-wasi-core yourself through the extensions tab.`);
                    return false;
                });
                if (!installed) {
                    return; // Extension dependency failed to install.
                }
            } else {
                vscode.window.showErrorMessage("Extension shader-validator failed to install dependencies. It will not launch the shader language server.");
                return; // Extension failed to launch.
            }
        }
    }

    // Create language client
    const server = new ShaderLanguageClient(context);
    context.subscriptions.push(server);
    const serverStatus = await server.start(context, false);

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
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.startServer", async (updateServerUsed: boolean) => {
        await server.start(context, updateServerUsed);
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
            vscode.window.showWarningMessage("Server logs are disabled. Do you want to enable them ? Server will restart.", "Yes", "No").then((value) => {
                if (value === "Yes") {
                    vscode.workspace.getConfiguration("shader-validator").update("trace.server", "messages", true);
                }
            });
        } else {
            server.showLogs();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpAst", () => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && ShaderLanguageClient.isEnabledLangId(activeTextEditor.document.languageId)) {
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
        if (activeTextEditor && activeTextEditor.document.uri.scheme === 'file' && ShaderLanguageClient.isEnabledLangId(activeTextEditor.document.languageId)) {
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
                let configurationRequiringAServerRestart = [
                    "shader-validator.trace.server",
                    "shader-validator.serverPath",
                    "shader-validator.slang.enabled",
                    "shader-validator.hlsl.enabled",
                    "shader-validator.glsl.enabled",
                    "shader-validator.wgsl.enabled",
                    "shader-validator.useWasiServer",
                ];
                let requiresRestart = false;
                for (let configuration of configurationRequiringAServerRestart) {
                    if (event.affectsConfiguration(configuration)) {
                        requiresRestart = true;
                        break;
                    }
                }
                if (requiresRestart) {
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