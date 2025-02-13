// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createLanguageClient, getServerPlatform, ServerPlatform } from './validator';
import { dumpAstRequest } from './request';

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





    const iconDecorationType = vscode.window.createTextEditorDecorationType({
        // Icon
        gutterIconPath: context.asAbsolutePath('./res/icons/hlsl-icon.svg'),
        gutterIconSize: "contain",
        // Minimap
        overviewRulerColor: "rgb(255, 0, 255)",  
        overviewRulerLane: vscode.OverviewRulerLane.Full,  
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
        // Border
		borderWidth: '1px',
		borderStyle: 'solid',
    });

    let activeEditor = vscode.window.activeTextEditor;
    function updateDecorations() {
        if (activeEditor) {
            // TODO: to gather this, hijack hover
            // On hover, if function, add button to set as entry point. register in toolbar aswell.
            // Pass to lsp
            const decoration0 = { range: new vscode.Range(new vscode.Position(5, 0), new vscode.Position(5, 0)), hoverMessage: 'Icon decoration' };
            const decoration1 = { range: new vscode.Range(new vscode.Position(10, 2), new vscode.Position(10, 10)), hoverMessage: 'Small decoration' };
            const decoration2 = { range: new vscode.Range(new vscode.Position(12, 0), new vscode.Position(12, 5)), hoverMessage: 'Large decoration' };
            activeEditor.setDecorations(iconDecorationType, [decoration0, decoration1, decoration2]);
        }
    }
	if (activeEditor) {
        // First open on IDE
		updateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
            updateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
            updateDecorations();
		}
	}, null, context.subscriptions);






    // https://code.visualstudio.com/api/ux-guidelines/sidebars
    // https://github.com/RedCMD/TmLanguage-Syntax-Highlighter/blob/main/package.json
    // https://code.visualstudio.com/api/extension-guides/tree-view
    class FtpNode {
        resource: vscode.Uri = vscode.Uri.parse("");
        isDirectory: boolean = false;
    }
    class FtpTreeDataProvider implements vscode.TreeDataProvider<FtpNode>, vscode.TextDocumentContentProvider {

        private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
        readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
    
    
        public refresh() {
            this._onDidChangeTreeData.fire(undefined);
        }
    
    
        public getTreeItem(element: FtpNode): vscode.TreeItem {
            return {
                resourceUri: element.resource,
                collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
                command: element.isDirectory ? void 0 : {
                    command: 'ftpExplorer.openFtpResource',
                    arguments: [element.resource],
                    title: 'Open FTP Resource'
                }
            };
        }
    
        public getChildren(element?: FtpNode): FtpNode[] | Thenable<FtpNode[]> {
            return element ? [element] : [];
        }
    
        public getParent(element: FtpNode): FtpNode | undefined {
            const parent = element.resource.with({ path: element.resource.path });
            return parent.path !== '//' ? { resource: parent, isDirectory: true } : undefined;
        }
    
        public provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<string> {
            return "salut";
        }
    }
    
    class FtpExplorer {
    
        private ftpViewer: vscode.TreeView<FtpNode>;
    
        constructor(context: vscode.ExtensionContext) {
            const treeDataProvider = new FtpTreeDataProvider();
            context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('shader-validator', treeDataProvider));
    
            this.ftpViewer = vscode.window.createTreeView('shader-validator', { treeDataProvider });
    
            vscode.commands.registerCommand('shader-validator.refresh', () => treeDataProvider.refresh());
        }
    
        private openResource(resource: vscode.Uri): void {
            vscode.window.showTextDocument(resource);
        }
    
        private async reveal(): Promise<void> {
            const node = this.getNode();
            if (node) {
                return this.ftpViewer.reveal(node);
            }
        }
    
        private getNode(): FtpNode | undefined {
            if (vscode.window.activeTextEditor) {
                if (vscode.window.activeTextEditor.document.uri.scheme === 'ftp') {
                    return { resource: vscode.window.activeTextEditor.document.uri, isDirectory: false };
                }
            }
            return undefined;
        }
    }
    let explorer = new FtpExplorer(context);



    
    // Create language client
    const client = await createLanguageClient(context);
    if (client === null) {
        vscode.window.showErrorMessage("Failed to launch shader-validator language server.");
        return;
    }
    // Subscribe for dispose
    context.subscriptions.push(vscode.Disposable.from(client));

    // Subscribe commands
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.validateFile", (data: string = 'current') => {
        vscode.window.showInformationMessage("Cannot validate file manually for now");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("shader-validator.dumpAst", (data: string = 'current') => {
        let activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor !== null) {
            console.log(activeTextEditor);
            client.sendRequest(dumpAstRequest, {
                uri: activeTextEditor?.document.uri.toString() // TODO: need to pass correctly formatted path.
            }).then((value: string | null) => {
                console.log(value);
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