import * as vscode from 'vscode';
import { EntryPointNode, EntryPointTreeDataProvider } from './entry-point';

export class Sidebar {
    private provider : EntryPointTreeDataProvider;
    private decorator: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new EntryPointTreeDataProvider;
        this.decorator = vscode.window.createTextEditorDecorationType({
            // Icon
            gutterIconPath: context.asAbsolutePath('./res/icons/hlsl-icon.svg'),
            gutterIconSize: "contain",
            // Minimap
            overviewRulerColor: "rgb(0, 174, 255)",  
            overviewRulerLane: vscode.OverviewRulerLane.Full,  
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            // Border
            borderWidth: '1px',
            borderStyle: 'solid',
        });
        this.activeEditor = vscode.window.activeTextEditor;
        this.setupGutter(context);
        
        context.subscriptions.push(vscode.window.registerTreeDataProvider('shader-validator-entry-points', this.provider));

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addEntryPoint", (node: EntryPointNode): void => {
            if (node.kind === 'file') {
                this.provider.addEntryPoint(node.uri, "main");
                this.provider.refresh();
            } else if (node.kind === 'defineList') {
                node.defines.push({
                    kind: "define",
                    label: "MY_MACRO",
                    value: "0",
                });
                this.provider.refresh();
            } else if (node.kind === 'includeList') {
                node.includes.push({
                    kind: "include",
                    include: "C:/",
                });
                this.provider.refresh();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.rereshEntryPoint", (node: EntryPointNode) => {
            vscode.window.showInformationMessage("Refreshing entry point");
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteEntryPoint", (node: EntryPointNode) => {
            if (node.kind === 'entryPoint') {
                this.provider.deleteEntryPoint(node);
                this.provider.refresh();
            } else if (node.kind === 'define') {
                //node.defines.indexOf(node);
                //this.provider.refresh();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editEntryPoint", async (node: EntryPointNode) => {
            if (node.kind === 'entryPoint') {
                let name = await vscode.window.showInputBox({});
                if (name) {
                    node.name = name;
                    this.provider.refresh();
                }
            } else if (node.kind === 'define') {
                let label = await vscode.window.showInputBox({});
                if (label) {
                    node.label = label;
                    this.provider.refresh();
                }
            } else if (node.kind === 'include') {
                let include = await vscode.window.showInputBox({});
                if (include) {
                    node.include = include;
                    this.provider.refresh();
                }
            }
        }));
    }
    async didOpenDocument(document: vscode.TextDocument, next: (data: vscode.TextDocument) => Promise<void>) : Promise<void> {
        this.provider.addFile(document.uri);
        next(document);
    }
    async didCloseDocument(document: vscode.TextDocument, next: (data: vscode.TextDocument) => Promise<void>) : Promise<void> {
        this.provider.deleteFile(document.uri);
        next(document);
    }

    private updateDecorations() {
        if (this.activeEditor) {
            let decorations : vscode.DecorationOptions[]= [];
            this.provider.visitEntryPoints(this.activeEditor.document.uri, (message: string, active: boolean) => {
                if (active) {
                    // TODO: get range
                    decorations.push({ range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), hoverMessage: message });
                }
            });
            this.activeEditor.setDecorations(this.decorator, decorations);
        }
    }
    private setupGutter(context: vscode.ExtensionContext) {
        if (this.activeEditor) {
            // First open on IDE
            this.updateDecorations();
        }
    
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.activeEditor = editor;
            if (editor) {
                this.updateDecorations();
            }
        }, null, context.subscriptions);
    
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.activeEditor && event.document === this.activeEditor.document) {
                this.updateDecorations();
            }
        }, null, context.subscriptions);
    }
}