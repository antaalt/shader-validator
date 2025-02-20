import * as vscode from 'vscode';
import { ShaderStage, ShaderVariant, ShaderVariantFile, ShaderVariantNode, ShaderVariantTreeDataProvider } from './shaderVariant';
import { LanguageClient } from 'vscode-languageclient/node';

const shaderVariantTreeKey : string = 'shader-validator.shader-variant-tree-key';

export class Sidebar {
    private provider : ShaderVariantTreeDataProvider;
    private decorator: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;
    private workspaceState: vscode.Memento;
    private client: LanguageClient;
    
    constructor(context: vscode.ExtensionContext, client: LanguageClient) {
        let variants : ShaderVariantFile[] = context.workspaceState.get<ShaderVariantFile[]>(shaderVariantTreeKey, []);
        this.client = client;
        this.provider = new ShaderVariantTreeDataProvider(variants, client);
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
        
        this.workspaceState = context.workspaceState;
        this.activeEditor = vscode.window.activeTextEditor;
        this.setupGutter(context);

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.addMenu", (node: ShaderVariantNode): void => {
            this.provider.add(node);
            this.workspaceState.update(shaderVariantTreeKey, this.provider.getFiles());
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", (node: ShaderVariantNode) => {
            this.provider.delete(node);
            this.workspaceState.update(shaderVariantTreeKey, this.provider.getFiles());
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            await this.provider.edit(node);
            this.workspaceState.update(shaderVariantTreeKey, this.provider.getFiles());
        }));
        // Open already opened document
        for (let editor of vscode.window.visibleTextEditors) {
            if (this.activeEditor && editor.document === this.activeEditor.document) {
                this.provider.open(editor.document.uri);
            }
        }
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
            this.provider.open(document.uri);
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
            this.provider.close(document.uri);
        }));
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