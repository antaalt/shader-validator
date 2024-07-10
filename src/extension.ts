// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { MountPointDescriptor, VSCodeFileSystemDescriptor, Wasm, WorkspaceFolderDescriptor } from '@vscode/wasm-wasi';

import { HLSLCompletionItemProvider } from './provider/completion';
import { HLSLHoverProvider } from './provider/hover';
import { HLSLDefinitionProvider } from './provider/definition';
import { HLSLSymbolProvider } from './provider/symbol';
import { ValidatorWasi } from './validatorWasi';
import { ValidatorChildProcess } from './validatorChildProcess';
import { Validator } from './validator';

function createValidator(): Validator {
    // Create validator
    // Should handle creation depending on supported platform (for dxc)
    console.log("creating some validation");
    //return new ValidatorWasi();
    return new ValidatorChildProcess();
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
    const validator = createValidator();
    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(validator));
    await validator.launch(context);

    const diagCol = vscode.languages.createDiagnosticCollection();
    const config = vscode.workspace.getConfiguration();

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            lint(validator, doc, diagCol);
        })
    );
    if (config.get<boolean>("shader.validateOnSave") === true)
    {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
                lint(validator, doc, diagCol);
            })
        );
    }
    if (config.get<boolean>("shader.validateOnType") === true)
    {
        let delay = config.get<number>("shader.validateOnType.delay") || 500;
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
                        // Here we need some way to pass the modified unsaved file to wasi server.
                        // Do we really want to save the file for the user ? Should create temporary file instead... 
                        // Or use wasm in memory file for caching it.
                        // Or simply send the content instead of path, but might be tricky for include handling.
                        //event.document.save();
                        lint(validator, event.document, diagCol);
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
                lint(validator, document, diagCol);
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

    // Validate on editor open
    let document = vscode.window.activeTextEditor?.document;
    if (document) {
        lint(validator, document, diagCol);
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
  diagCol: vscode.DiagnosticCollection
) {
    const config = vscode.workspace.getConfiguration();
    if (document.languageId === "hlsl" || document.languageId === "wgsl" || document.languageId === "glsl") {
        validator.validateFile(document, document.languageId, (json) => {
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
                        let severityRequired = getSeverityFromString(config.get<string>("shader.severity") || "hint");
                        if (severity <= severityRequired)
                        {
                            let start = new vscode.Position(err.line - 1, err.pos);
                            let end = new vscode.Position(err.line - 1, err.pos);
                            let diagnostic: vscode.Diagnostic = {
                                severity: severity,
                                range: new vscode.Range(start, end),
                                message: err.error,
                                source: "shader-validator",
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
                            message: `${err.message}`,//\n\n${err.debug}`,
                            source: "shader-validator",
                        };
                        diagnostics.push(diagnostic);
            
                    } 
                    else if (message.UnknownError) 
                    {
                        let start = new vscode.Position(0, 0);
                        let end = new vscode.Position(0, 0);
                
                        let diagnostic: vscode.Diagnostic = {
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(start, end),
                            message: message.UnknownError,
                            source: "shader-validator",
                        };
                        diagnostics.push(diagnostic);
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
}