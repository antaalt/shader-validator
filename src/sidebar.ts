import * as vscode from 'vscode';
import { ShaderStage, ShaderVariant, ShaderVariantNode, ShaderVariantTreeDataProvider } from './shaderVariant';

export class Sidebar {
    private provider : ShaderVariantTreeDataProvider;
    private decorator: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new ShaderVariantTreeDataProvider;
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
        
        context.subscriptions.push(vscode.window.registerTreeDataProvider('shader-validator-variants', this.provider));

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addMenu", (node: ShaderVariantNode): void => {
            this.provider.add(node);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", (node: ShaderVariantNode) => {
            this.provider.delete(node);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            this.provider.edit(node);
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
            this.provider.visitShaderVariants(this.activeEditor.document.uri, (variant: ShaderVariant) => {
                if (variant.isActive) {
                    // TODO: get range of variant.name from server.
                    decorations.push({ range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), hoverMessage: variant.name });
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