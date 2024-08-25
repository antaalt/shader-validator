// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as cp from "child_process";

import { createLanguageClientWASI, createLanguageClientStandard } from './validator';
import { LanguageClient } from 'vscode-languageclient/node';

function isRunningInBrowser(): boolean {
    return typeof cp.spawn !== 'function';
}

async function createValidator(context: vscode.ExtensionContext): Promise<LanguageClient> {
    // Create validator
    // Web does not support child process, use wasi instead.
    if (isRunningInBrowser()) {
        return createLanguageClientWASI(context);
    } else {
        return createLanguageClientStandard(context);
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
    // Install dependencies if running on browser
    const msWasmWasiCoreName = 'ms-vscode.wasm-wasi-core';
    const msWasmWasiCore = vscode.extensions.getExtension(msWasmWasiCoreName);
    if (msWasmWasiCore === undefined && isRunningInBrowser()) 
    {
        const message = 'It is required to install Microsoft WASM wasi core for running the shader validator server on the web. Do you want to install it now?';
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
                        vscode.commands.executeCommand("workbench.extensions.installExtension", msWasmWasiCoreName, {
                            installPreReleaseVersion: true
                        });
                    });
                },
            );
        } else {
            vscode.window.showErrorMessage("Extension shader-validator failed to install dependencies. It will not launch the validation server.");
            return; // Extension failed to launch.
        }
    }
    // Create validator
    const validator = await createValidator(context);
    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(validator));
}


// This method is called when your extension is deactivated
export function deactivate(context: vscode.ExtensionContext) {
    // Validator should self destruct thanks to vscode.Disposable
}