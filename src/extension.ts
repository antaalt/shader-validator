// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { MountPointDescriptor, VSCodeFileSystemDescriptor, Wasm, WorkspaceFolderDescriptor } from '@vscode/wasm-wasi';

import { HLSLCompletionItemProvider } from './provider/completion';
import { HLSLHoverProvider } from './provider/hover';
import { HLSLDefinitionProvider } from './provider/definition';
import { HLSLSymbolProvider } from './provider/symbol';
import { Validator } from './validator';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
    // Create validator
    console.log("creating some validation");
    const validator = new Validator();
    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(validator));
    await validator.launch(context);

    const diagCol = vscode.languages.createDiagnosticCollection();
    const config = vscode.workspace.getConfiguration();
    // config.get("") for settings

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            lint(validator, doc, diagCol);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            lint(validator, doc, diagCol);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((doc) => {
            lint(validator, doc.document, diagCol);
        })
    );

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    context.subscriptions.push(
        vscode.commands.registerCommand('hlsl.helloWorld', () => {
            // The code you place here will be executed every time your command is executed
            // Display a message box to the user
            vscode.window.showInformationMessage('Hello World from hlsl!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("hlsl.validateFile", () => {
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
                
                        let start = new vscode.Position(err.line - 1, err.pos);
                        let end = new vscode.Position(err.line - 1, err.pos);
                        let diagnostic: vscode.Diagnostic = {
                            severity: getSeverityFromString(err.severity),
                            range: new vscode.Range(start, end),
                            message: err.error,
                            source: "hlsl-validator",
                        };
                        diagnostics.push(diagnostic);
            
                    }
                    else if (message.ValidationErr)
                    {
                        let err = message.ValidationErr;
                
                        let start = new vscode.Position(0, 0);
                        let end = new vscode.Position(document.lineCount - 1, 0);
                
                        let diagnostic: vscode.Diagnostic = {
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(start, end),
                            message: `${err.message}\n\n${err.debug}`,
                            source: "hlsl-validator",
                        };
                        diagnostics.push(diagnostic);
            
                    } 
                    else if (message.UnknownError) 
                    {
                        let start = new vscode.Position(0, 0);
                        let end = new vscode.Position(document.lineCount - 1, 0);
                
                        let diagnostic: vscode.Diagnostic = {
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(start, end),
                            message: message.UnknownError,
                            source: "hlsl-validator",
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