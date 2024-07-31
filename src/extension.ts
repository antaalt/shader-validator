// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from "child_process";

import { HLSLCompletionItemProvider } from './provider/completion';
import { HLSLHoverProvider } from './provider/hover';
import { HLSLDefinitionProvider } from './provider/definition';
import { HLSLSymbolProvider } from './provider/symbol';
import { ValidatorWasi } from './validatorWasi';
import { ValidatorChildProcess } from './validatorChildProcess';
import { getTemporaryFolder, Validator } from './validator';

function isRunningInBrowser(): boolean {
    return typeof cp.spawn !== 'function';
}

function createValidator(): Validator {
    // Create validator
    // Web does not support child process, use wasi instead.
    if (isRunningInBrowser()) {
        return new ValidatorWasi();
    } else {
        return new ValidatorChildProcess();
    }
}

function getBaseName(fileName: string) {
    return fileName.split('\\').pop()?.split('/').pop() || "";
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
    // Create temporary folder
    if (!isRunningInBrowser()) {
        fs.mkdir(getTemporaryFolder(), { recursive: true }, e => console.assert(e === null, e));
    }
    // Create validator
    const validator = createValidator();
    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(validator));
    await validator.launch(context);

    const diagCol = vscode.languages.createDiagnosticCollection();
    const config = vscode.workspace.getConfiguration();

    const validate = config.get<boolean>("shader.validateOnSave") === true || config.get<boolean>("shader.validateOnType") === true;

    if (config.get<boolean>("shader.validateOnSave") === true)
    {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
                lint(validator, doc, null, diagCol);
            })
        );
    }
    if (config.get<boolean>("shader.validateOnType") === true && !isRunningInBrowser())
    {
        let delay = config.get<number>("shader.validateOnType.delay", 500);
        // This is triggered on save / undo / redo / user typing
        let changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event : vscode.TextDocumentChangeEvent) => {
                if (event.contentChanges.length > 0) {
                    const fileName = event.document.fileName;

                    const timer = changeTimers.get(fileName);
                    if (timer) {
                        clearTimeout(timer);
                    }
                    changeTimers.set(fileName, setTimeout(() => {
                        changeTimers.delete(fileName);
                        // Write content to temporary folder & pass path to linter.
                        let tempDir = getTemporaryFolder();
                        let path = tempDir + getBaseName(fileName); // Keep same file
                        fs.writeFileSync(path, event.document.getText(), {
                            flag: "w"
                        });
                        lint(validator, event.document, path, diagCol);
                    }, delay));
                }
            })
        );
    }
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event : vscode.ConfigurationChangeEvent) => {
            // Could reset linting for all open files ?
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("shader.validateFile", () => {
            let document = vscode.window.activeTextEditor?.document;
            if (document) {
                lint(validator, document, null, diagCol);
            }
        })
    );
  
    // Hover information
    /*context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            "hlsl",
            new HLSLHoverProvider(linter)
        )
    );
    // Auto completion
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            "hlsl", 
            new HLSLCompletionItemProvider(linter)
        )
    );
    // Jump to definition
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            "hlsl", 
            new HLSLDefinitionProvider(linter)
        )
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            "hlsl", 
            new HLSLSymbolProvider(linter)
        )
    );*/

    if (validate)
    {
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                lint(validator, doc, null, diagCol);
            })
        );
        // Validate on editor open
        let document = vscode.window.activeTextEditor?.document;
        if (document) {
            lint(validator, document, null, diagCol);
        }
    }
}

function getSeverityFromString(severity: string): vscode.DiagnosticSeverity {
    switch(severity) {
        case "error": return vscode.DiagnosticSeverity.Error;
        case "warning": return vscode.DiagnosticSeverity.Warning;
        case "info": return vscode.DiagnosticSeverity.Information;
        case "hint": return vscode.DiagnosticSeverity.Hint;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

function lint(
  validator: Validator,
  document: vscode.TextDocument,
  temporaryFile: string | null,
  diagCol: vscode.DiagnosticCollection
) {
    if (document.languageId === "hlsl" || document.languageId === "wgsl" || document.languageId === "glsl") {
        const config = vscode.workspace.getConfiguration();
        let includes = config.get<string[]>("shader.includes", []);
        let definesObject = config.get<Object>("shader.defines", {});
        let defines : {[key: string]: string} = {};
        for (const [key, value] of Object.entries(definesObject)) {
            defines[key] = value;
        }
        let params = { includes, defines };
        validator.validateFile(document, document.languageId, temporaryFile, params, (json) => {
            if (document === null) { return; }
            diagCol.delete(document.uri);
            if (!json) { return; }

            if (json.result.IsOk) 
            {
                console.log("Linted file without errors.");
            } 
            else if (json.result.Messages) 
            {
                if (json.result.Messages.length === 0) { return;}
                let diagnostics: vscode.Diagnostic[] = [];
                json.result.Messages.forEach((message) => {
                    if (message.ParserErr)
                    {
                        let err = message.ParserErr;
                        let severity = getSeverityFromString(err.severity);
                        let severityRequired = getSeverityFromString(config.get<string>("shader.severity", "hint"));
                        let filename = getBaseName(document.fileName);
                        if (severity <= severityRequired && (err.filename === filename || err.filename === null))
                        {
                            let start = new vscode.Position(err.line - 1, err.pos);
                            let end = new vscode.Position(err.line - 1, err.pos);
                            let diagnostic: vscode.Diagnostic = {
                                severity: severity,
                                range: new vscode.Range(start, end),
                                message: err.error,
                                source: "shader-validator:" + filename,
                            };
                            diagnostics.push(diagnostic);
                        }
                    }
                    else if (message.ValidationErr)
                    {
                        let err = message.ValidationErr;
                
                        let start = new vscode.Position(0, 0);
                        let end = new vscode.Position(0, 0);
                
                        let diagnostic: vscode.Diagnostic = {
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(start, end),
                            message: `${err.message}`,
                            source: "shader-validator",
                        };
                        diagnostics.push(diagnostic);
            
                    } 
                    else if (message.UnknownError) 
                    {
                        vscode.window.showErrorMessage("Internal error: " + message.UnknownError);
                    }
                });
                diagCol.set(document.uri, diagnostics);
            }
            else
            {
                console.log("Linted file with errors.");
            }
        });
    }
}

// This method is called when your extension is deactivated
export function deactivate(context: vscode.ExtensionContext) {
    // Validator should self destruct thanks to vscode.Disposable
    // Remove temporary files created during extension usage.
    if (!isRunningInBrowser()) {
        fs.rm(getTemporaryFolder(), { recursive: true, force: true }, e => console.assert(e === null, e));
    }
}