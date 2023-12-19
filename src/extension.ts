// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Linter } from "./linter";
import { HLSLCompletionItemProvider } from './provider/completion';
import { HLSLHoverProvider } from './provider/hover';
import { HLSLDefinitionProvider } from './provider/definition';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "hlsl" is now active!');

  const linter = new Linter();
  const diagCol = vscode.languages.createDiagnosticCollection();
  const config = vscode.workspace.getConfiguration();
  // config.get("") for settings

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      linter.lint(doc, diagCol);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      linter.lint(doc, diagCol);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((doc) => {
      linter.lint(doc.document, diagCol);
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
        linter.lint(document, diagCol);
      }
    })
  );
  
  // Hover information
  context.subscriptions.push(
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

  // Validate on editor open
  let document = vscode.window.activeTextEditor?.document;
  if (document) {
    linter.lint(document, diagCol);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}