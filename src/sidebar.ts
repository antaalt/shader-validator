import * as vscode from 'vscode';
import { ShaderStage, ShaderVariantNode, ShaderVariantTreeDataProvider } from './shaderVariant';

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
            if (node.kind === 'file') {
                this.provider.addShaderVariant(node.uri, "main");
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
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.deleteMenu", (node: ShaderVariantNode) => {
            if (node.kind === 'variant') {
                this.provider.deleteShaderVariant(node);
                this.provider.refresh();
            } else if (node.kind === 'define') {
                //node.defines.indexOf(node);
                //this.provider.refresh();
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.editMenu", async (node: ShaderVariantNode) => {
            
            if (node.kind === 'variant') {
                let name = await vscode.window.showInputBox({
                    title: "Entry point selection",
                    value: node.name,
                    prompt: "Select an entry point name for your variant",
                    placeHolder: "main"
                });
                if (name) {
                    node.name = name;
                    this.provider.refresh();
                }
            } else if (node.kind === 'define') {
                let label = await vscode.window.showInputBox({
                    title: "Macro label",
                    value: node.label,
                    prompt: "Select a label for you macro.",
                    placeHolder: "MY_MACRO"
                });
                let value = await vscode.window.showInputBox({
                    title: "Macro value",
                    value: node.value,
                    prompt: "Select a value for you macro.",
                    placeHolder: "0"
                });
                if (label) {
                    node.label = label;
                }
                if (value) {
                    node.value = value;
                }
                if (value || label) {
                    this.provider.refresh();
                }
            } else if (node.kind === 'include') {
                let include = await vscode.window.showInputBox({
                    title: "Include path",
                    value: node.include,
                    prompt: "Select a path for your include.",
                    placeHolder: "C:/Users/"
                });
                if (include) {
                    node.include = include;
                    this.provider.refresh();
                }
            } else if (node.kind === 'stage') {

                let stage = await vscode.window.showQuickPick(
                    [
                        ShaderStage[ShaderStage.auto],
                        ShaderStage[ShaderStage.vertex],
                        ShaderStage[ShaderStage.fragment],
                        ShaderStage[ShaderStage.compute],
                        ShaderStage[ShaderStage.tesselationControl],
                        ShaderStage[ShaderStage.tesselationEvaluation],
                        ShaderStage[ShaderStage.mesh],
                        ShaderStage[ShaderStage.task],
                        ShaderStage[ShaderStage.geometry],
                        ShaderStage[ShaderStage.rayGeneration],
                        ShaderStage[ShaderStage.closestHit],
                        ShaderStage[ShaderStage.anyHit],
                        ShaderStage[ShaderStage.callable],
                        ShaderStage[ShaderStage.miss],
                        ShaderStage[ShaderStage.intersect],
                    ],
                    {
                        title: "Shader stage"
                    }
                );
                if (stage) {
                    node.stage = ShaderStage[stage as keyof typeof ShaderStage];
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
            this.provider.visitShaderVariants(this.activeEditor.document.uri, (message: string, active: boolean) => {
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