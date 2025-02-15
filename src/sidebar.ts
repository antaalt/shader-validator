import * as vscode from 'vscode';
import { EntryPointNode, EntryPointTreeDataProvider, EntryPointDataTreeDataProvider, ShaderVariantEditor } from './entry-point';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

export class Sidebar {
    private provider : EntryPointTreeDataProvider;
    //private editor: EntryPointDataTreeDataProvider;
    private editor: ShaderVariantEditor;
    private decorator: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new EntryPointTreeDataProvider;
        //this.editor = new EntryPointDataTreeDataProvider;
        this.editor = new ShaderVariantEditor;
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
        //context.subscriptions.push(vscode.window.registerTreeDataProvider('shader-validator-shader-variant', this.editor));
        context.subscriptions.push(vscode.window.registerWebviewViewProvider('shader-validator-shader-variant', this.editor));

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addEntryPoint", (node: EntryPointNode): void => {
            if (node.kind === 'file') {
                this.provider.addEntryPoint(node.uri, "main");
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
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.setCurrentEntryPoint", (node: EntryPointNode) => {
            if (node.kind === 'entryPoint') {
                this.editor.setCurrentEntryPoint(node);
                // TODO: execute goto entrypoint aswell
            } else {
                this.editor.setCurrentEntryPoint(null);
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
            this.provider.visitEntryPoints(this.activeEditor.document.uri, (message: string, range: vscode.Range, active: boolean) => {
                if (active) {
                    decorations.push({ range, hoverMessage: message });
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