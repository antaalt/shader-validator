// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { MountPointDescriptor, VSCodeFileSystemDescriptor, Wasm, WorkspaceFolderDescriptor } from '@vscode/wasm-wasi';

import { Linter } from "./linter";
import { HLSLCompletionItemProvider } from './provider/completion';
import { HLSLHoverProvider } from './provider/hover';
import { HLSLDefinitionProvider } from './provider/definition';
import { HLSLSymbolProvider } from './provider/symbol';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext)
{
  // Load the WASM API
  const wasm: Wasm = await Wasm.api();

  const pty = wasm.createPseudoterminal();
  const terminal = vscode.window.createTerminal({
    name: 'Shader language server',
    pty,
    isTransient: true
  });
  terminal.show(true);
  // Create virtual file systems to access workspaces from wasi app
  let mountPoints : MountPointDescriptor[] = [];
  const testMountPoint : VSCodeFileSystemDescriptor = { kind: 'vscodeFileSystem', uri: vscode.Uri.joinPath(context.extensionUri, "test"), mountPoint:"/test"};
  mountPoints.push(testMountPoint);
  vscode.workspace.workspaceFolders?.forEach((element) => {
    const workspaceMountPoint : VSCodeFileSystemDescriptor = { kind: 'vscodeFileSystem', uri: element.uri, mountPoint:"/test"};
    mountPoints.push(workspaceMountPoint);
  });
  try {
    // Load the WASM module. It is stored alongside the extension's JS code.
    // So we can use VS Code's file system API to load it. Makes it
    // independent of whether the code runs in the desktop or the web.
    //const extensionLocalPath = 'shader-language-server/pkg/shader_language_server.wasm';
    const extensionLocalPath = 'shader-language-server/target/wasm32-wasi/debug/shader_language_server.wasm';
    const bits = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, extensionLocalPath));
    const module = await WebAssembly.compile(bits);
    // Create a WASM process.
    const process = await wasm.createProcess('shader-language-server', module, { 
      stdio: pty.stdio,
      args:[],
      env:{},
      mountPoints: mountPoints,
    });
    console.log(module);
    console.log(process);
    // Run the process and wait for its result.
    const result = await process.run();
    if (result !== 0) {
      await vscode.window.showErrorMessage(`Process shader-language-server ended with error: ${result}`);
    }
  } catch (error : any) {
    // Show an error message if something goes wrong.
    await vscode.window.showErrorMessage(error.message);
  }

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
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      "hlsl", 
      new HLSLSymbolProvider(linter)
    )
  );

  // Validate on editor open
  let document = vscode.window.activeTextEditor?.document;
  if (document) {
    linter.lint(document, diagCol);
  }
}

// This method is called when your extension is deactivated
export function deactivate(context: vscode.ExtensionContext) {}