import * as vscode from 'vscode';
import { EntryPointTreeDataProvider } from './entry-point';
import { ProvideDocumentSymbolsSignature } from 'vscode-languageclient';

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
    }
    // TODO: should mix workspace request & document to have every files avilable in workspace & keep them in memory.
    async provideDocumentSymbol(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) : Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | null | undefined> {
        let symbols = await this.provider.documentSymbolProvider(document, token, next);
        // Await & trigger decorations update once we have symbols.
        this.updateDecorations();
        return symbols;
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