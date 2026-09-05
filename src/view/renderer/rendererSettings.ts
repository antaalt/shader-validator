import * as vscode from 'vscode';

import { resolveVSCodeVariables } from '../../client';
import { ShaderStage, ShaderVariant } from '../variant/variant';
import { ShaderVariantTreeDataProvider } from '../variant/shaderVariantTreeView';
import { ShaderRendererView } from './rendererView';
import { rendererStages } from './rendererProtocol';

const rendererStageBindingKey: string = 'shader-validator.renderer-stage-binding-key';

/// A stage of the renderer pipeline, holding whichever shader variant is bound to it.
export type RendererStageNode = {
    kind: 'rendererStage',
    stage: ShaderStage,
};

export type RendererSettingsNode = RendererStageNode;

/// A binding as it is persisted: only the identity of the variant is stored, so that it is resolved
/// against the live variant on reload instead of holding a stale copy of it.
type SerializedStageBinding = {
    stage: string,
    uri: string,
    entryPoint: string,
};

/// Tree listing what is sent to the renderer: one row per pipeline stage, showing the shader variant
/// bound to it & letting the user pick it among the declared variants.
///
/// The bindings themselves live in ShaderRendererView, which pushes them to the renderer process.
/// This view is the only place they are edited from, and persists them per workspace.
export class RendererSettingsTreeDataProvider implements vscode.TreeDataProvider<RendererSettingsNode> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<RendererSettingsNode | undefined | void> = new vscode.EventEmitter<RendererSettingsNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<RendererSettingsNode | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private rendererView: ShaderRendererView;
    private variantProvider: ShaderVariantTreeDataProvider;
    /// Signature of the variant last pushed to each stage, to notice an edit of it made from the
    /// variants view & push it again.
    private bindingSignatures: Map<ShaderStage, string>;
    /// One node per stage of the renderer pipeline, kept so that the tree always hands out the same
    /// element for a stage.
    private stageNodes: RendererStageNode[];

    // Serialization & Editor
    private tree: vscode.TreeView<RendererSettingsNode>;
    private workspaceState: vscode.Memento;

    constructor(context: vscode.ExtensionContext, rendererView: ShaderRendererView, variantProvider: ShaderVariantTreeDataProvider) {
        this.workspaceState = context.workspaceState;
        this.rendererView = rendererView;
        this.variantProvider = variantProvider;
        this.bindingSignatures = new Map;
        this.stageNodes = rendererStages.map(stage => {
            return {
                kind: 'rendererStage',
                stage: stage,
            } as RendererStageNode;
        });
        this.tree = vscode.window.createTreeView<RendererSettingsNode>("shader-validator-renderer", {
            treeDataProvider: this
        });
        // The renderer view owns the bindings, so follow them instead of caching them here.
        context.subscriptions.push(this.rendererView.onDidChangeStageBindings(() => {
            this.bindingSignatures = new Map(Array.from(this.rendererView.getShaderVariants())
                .map(([stage, variant]) => [stage, getVariantSignature(variant)]));
            this.save();
            this.updateTreeView();
        }));
        // A variant a stage points at can be deleted, edited or reloaded from its database, none of
        // which goes through this view.
        context.subscriptions.push(this.variantProvider.onDidChangeTreeData(() => {
            this.syncBindings();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.setRendererStage", async (node: RendererSettingsNode) => {
            await this.promptStageBinding(node.stage);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.clearRendererStage", async (node: RendererSettingsNode) => {
            await this.rendererView.setShaderVariant(node.stage, null);
        }));
        this.load();
    }

    private load() {
        let bindings = this.workspaceState.get<SerializedStageBinding[]>(rendererStageBindingKey, []);
        let variants = this.variantProvider.getAllVariants();
        for (let binding of bindings) {
            let stage = ShaderStage[binding.stage as keyof typeof ShaderStage];
            let variant = variants.find(v => v.uri.toString() === binding.uri && v.name === binding.entryPoint);
            if (stage === undefined || variant === undefined) {
                // A variant which was deleted or renamed since it was bound simply drops its binding.
                continue;
            }
            this.rendererView.setShaderVariant(stage, variant);
        }
    }
    /// Re-resolve every binding against the declared variants, so that the renderer keeps rendering
    /// what this view displays after the variants view changed.
    private syncBindings() {
        let variants = this.variantProvider.getAllVariants();
        for (let [stage, boundVariant] of Array.from(this.rendererView.getShaderVariants())) {
            // Match on identity first, so that a binding survives a rename of its entry point, then
            // on file & entry point, so that it survives a database reload building new nodes.
            let variant = variants.includes(boundVariant)
                ? boundVariant
                : variants.find(v => v.uri.toString() === boundVariant.uri.toString() && v.name === boundVariant.name);
            if (variant === undefined) {
                // The variant a stage points at is gone, so nothing is rendered for it anymore.
                this.rendererView.setShaderVariant(stage, null);
            } else if (variant !== boundVariant || this.bindingSignatures.get(stage) !== getVariantSignature(variant)) {
                this.rendererView.setShaderVariant(stage, variant);
            }
        }
    }
    private save() {
        let bindings = Array.from(this.rendererView.getShaderVariants()).map(([stage, variant]) => {
            return {
                stage: ShaderStage[stage],
                uri: variant.uri.toString(),
                entryPoint: variant.name,
            } as SerializedStageBinding;
        });
        this.workspaceState.update(rendererStageBindingKey, bindings);
    }

    /// Pick the variant to bind to a stage of the renderer pipeline, among the declared ones.
    private async promptStageBinding(stage: ShaderStage) {
        type StageBindingItem = vscode.QuickPickItem & { variant: ShaderVariant | null };
        let variants = this.variantProvider.getAllVariants();
        if (variants.length === 0) {
            vscode.window.showWarningMessage(`No shader variant declared to bind to the ${ShaderStage[stage]} stage. Add one from the variants view first.`);
            return;
        }
        let boundVariant = this.rendererView.getShaderVariant(stage);
        let toItem = (variant: ShaderVariant): StageBindingItem => {
            return {
                label: variant.name,
                description: vscode.workspace.asRelativePath(variant.uri),
                detail: describeVariantContext(variant),
                variant: variant,
            };
        };
        // A variant declaring this stage is what the user is most likely after, but the renderer
        // takes any entry point for a stage, so the other ones stay reachable below.
        let matchingVariants = variants.filter(v => v.stage.stage === stage || v.stage.stage === ShaderStage.auto);
        let otherVariants = variants.filter(v => !matchingVariants.includes(v));
        let items: StageBindingItem[] = [];
        if (matchingVariants.length > 0) {
            items.push({ label: ShaderStage[stage], kind: vscode.QuickPickItemKind.Separator, variant: null });
            items.push(...matchingVariants.map(toItem));
        }
        if (otherVariants.length > 0) {
            items.push({ label: "other stages", kind: vscode.QuickPickItemKind.Separator, variant: null });
            items.push(...otherVariants.map(toItem));
        }
        if (boundVariant !== undefined) {
            items.push({ label: "", kind: vscode.QuickPickItemKind.Separator, variant: null });
            items.push({
                label: "$(close) None",
                detail: `Unbind ${boundVariant.name} & let the renderer use its default ${ShaderStage[stage]} shader.`,
                variant: null,
            });
        }
        let item = await vscode.window.showQuickPick(items, {
            title: `Shader to render as ${ShaderStage[stage]}`,
            placeHolder: boundVariant ? `Currently ${boundVariant.name}` : 'No shader bound to this stage',
            matchOnDescription: true,
        });
        if (item === undefined) {
            return; // Cancelled.
        }
        await this.rendererView.setShaderVariant(stage, item.variant);
    }

    public updateTreeView(node?: RendererSettingsNode) {
        this.onDidChangeTreeDataEmitter.fire(node);
    }

    public getTreeItem(element: RendererSettingsNode): vscode.TreeItem {
        if (element.kind === 'rendererStage') {
            let variant = this.rendererView.getShaderVariant(element.stage);
            let item = new vscode.TreeItem(ShaderStage[element.stage], vscode.TreeItemCollapsibleState.None);
            if (variant === undefined) {
                item.description = 'none';
                item.tooltip = new vscode.MarkdownString(`No shader bound to the \`${ShaderStage[element.stage]}\` stage. The renderer uses its default one.`);
                // Clicking a stage is how a shader is picked for it, as there is nothing to expand.
                item.command = {
                    title: "Set shader",
                    command: 'shader-validator.setRendererStage',
                    arguments: [
                        element
                    ]
                };
            } else {
                item.description = `${variant.name} • ${vscode.workspace.asRelativePath(variant.uri)}`;
                item.tooltip = getStageTooltip(element.stage, variant);
                item.resourceUri = variant.uri;
                item.command = {
                    title: "Go to variant",
                    command: 'shader-validator.gotoShaderEntryPoint',
                    arguments: [
                        variant.uri,
                        variant.name
                    ]
                };
            }
            item.contextValue = variant === undefined ? element.kind : 'rendererStageBound';
            return item;
        } else {
            console.error("Unimplemented kind: ", element);
            return undefined!; // unreachable
        }
    }

    public getChildren(element?: RendererSettingsNode): RendererSettingsNode[] {
        if (element) {
            return []; // Stages are leaves.
        } else {
            return this.stageNodes;
        }
    }

    dispose() {
        this.onDidChangeTreeDataEmitter.dispose();
        this.tree.dispose();
    }
}

/// Everything of a variant which ends up sent to the renderer, so that an edit of it is noticed.
function getVariantSignature(variant: ShaderVariant): string {
    return JSON.stringify([
        variant.uri.toString(),
        variant.name,
        variant.defines.defines.map(define => [define.label, define.value]),
        variant.includes.includes.map(include => include.include),
    ]);
}

/// Defines & includes a variant is compiled with, as a single line for a quick pick.
function describeVariantContext(variant: ShaderVariant): string {
    let defines = variant.defines.defines.map(define => `${define.label}=${define.value}`);
    let includes = variant.includes.includes.map(include => include.include);
    let context = [];
    if (defines.length > 0) {
        context.push(`defines: ${defines.join(', ')}`);
    }
    if (includes.length > 0) {
        context.push(`includes: ${includes.join(', ')}`);
    }
    return context.join(' | ');
}

/// Everything sent to the renderer for a stage, so that it can be reviewed without opening the
/// variants view.
function getStageTooltip(stage: ShaderStage, variant: ShaderVariant): vscode.MarkdownString {
    let tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`Rendered as \`${ShaderStage[stage]}\`\n\n`);
    tooltip.appendMarkdown(`- Entry point: \`${variant.name}\`\n`);
    tooltip.appendMarkdown(`- File: \`${vscode.workspace.asRelativePath(variant.uri)}\`\n`);
    if (variant.stage.stage !== stage) {
        // Nothing prevents it, but a mismatch is worth pointing out as it is rarely intended.
        tooltip.appendMarkdown(`- Declared stage: \`${ShaderStage[variant.stage.stage]}\`\n`);
    }
    for (let define of variant.defines.defines) {
        tooltip.appendMarkdown(`- Define: \`${define.label}=${define.value}\`\n`);
    }
    for (let include of variant.includes.includes) {
        tooltip.appendMarkdown(`- Include: \`${resolveVSCodeVariables(include.include)}\`\n`);
    }
    return tooltip;
}
