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
    // TODO: should we instead plug on workspace symbols ?
    // What about updates ?
    async provideDocumentSymbol(document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) : Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | null | undefined> {
        return this.provider.documentSymbolProvider(document, token, next);
    }
    async didCloseDocument(document: vscode.TextDocument, next: (data: vscode.TextDocument) => Promise<void>) : Promise<void> {
        this.provider.delete(document.uri);
    }

    private updateDecorations() {
        if (this.activeEditor) {
            
            // TODO: read current active entry points instead.
            //let entryPoints = this.provider.getEntryPoint(this.activeEditor.document.uri);

            const decoration0 = { range: new vscode.Range(new vscode.Position(5, 0), new vscode.Position(5, 0)), hoverMessage: 'Icon decoration' };
            const decoration1 = { range: new vscode.Range(new vscode.Position(10, 2), new vscode.Position(10, 10)), hoverMessage: 'Small decoration' };
            const decoration2 = { range: new vscode.Range(new vscode.Position(12, 0), new vscode.Position(12, 5)), hoverMessage: 'Large decoration' };
            this.activeEditor.setDecorations(this.decorator, [decoration0, decoration1, decoration2]);
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