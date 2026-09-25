import * as vscode from 'vscode';
import path from 'path';
import { ServerStatus, ShaderLanguageClient } from '../../client';
import { DependencyTreeNode, dependencyTreeRequest } from '../../request';
import { ShaderVariantTreeDataProvider } from '../variant/shaderVariantTreeView';

// Delay before refreshing the tree after an edit, to avoid requesting the server on every keystroke.
const refreshDebounceInMs : number = 500;

const followActiveVariantKey : string = 'shader-validator.dependency-tree-follow-active-variant-key';
// Drives which of the two toggle buttons is visible in the view title.
const followActiveVariantContextKey : string = 'shader-validator.dependencyTreeFollowsActiveVariant';

export interface ShaderDependency {
    uri: vscode.Uri,
    includes: ShaderDependency[],
    // Set when the file is already one of its own ancestors. Its includes are not expanded again.
    isRecursive: boolean,
}

function toShaderDependency(server: ShaderLanguageClient, node: DependencyTreeNode, ancestors: string[]): ShaderDependency {
    // Include guards make a file including itself indirectly perfectly legal, so stop expanding
    // instead of recursing forever.
    let isRecursive = ancestors.includes(node.url);
    return {
        // Uris live in the server namespace, which is the mounted one under WASI, so they have to
        // go through the client converter, the exact inverse of the uriAsString used to request it.
        uri: server.stringAsUri(node.url),
        includes: isRecursive ? [] : node.includes.map(include => toShaderDependency(server, include, [...ancestors, node.url])),
        isRecursive: isRecursive,
    };
}

function collectDependencies(node: ShaderDependency, dependencies: Set<string>) {
    for (let include of node.includes) {
        dependencies.add(include.uri.toString());
        collectDependencies(include, dependencies);
    }
}

export class ShaderDependencyTreeDataProvider implements vscode.TreeDataProvider<ShaderDependency> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderDependency | undefined | void> = new vscode.EventEmitter<ShaderDependency | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderDependency | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private server: ShaderLanguageClient;
    private variants: ShaderVariantTreeDataProvider;
    private tree: vscode.TreeView<ShaderDependency>;
    private root: ShaderDependency | null = null;
    // When set, inspect the active variant file instead of following the active editor.
    private followActiveVariant: boolean;
    // Increased on every refresh so that a slow request cannot overwrite the result of a newer one.
    private refreshId: number = 0;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined = undefined;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient, variants: ShaderVariantTreeDataProvider) {
        this.server = server;
        this.variants = variants;
        this.followActiveVariant = context.workspaceState.get<boolean>(followActiveVariantKey, false);
        this.tree = vscode.window.createTreeView<ShaderDependency>("shader-validator-dependencies", {
            treeDataProvider: this
        });
        context.subscriptions.push(this.tree);

        const setFollowActiveVariant = async (followActiveVariant: boolean) => {
            this.followActiveVariant = followActiveVariant;
            await context.workspaceState.update(followActiveVariantKey, followActiveVariant);
            await vscode.commands.executeCommand('setContext', followActiveVariantContextKey, followActiveVariant);
            this.requestRefresh();
        };
        vscode.commands.executeCommand('setContext', followActiveVariantContextKey, this.followActiveVariant);

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.followActiveVariantInDependencyTree", async () => {
            await setFollowActiveVariant(true);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.followActiveEditorInDependencyTree", async () => {
            await setFollowActiveVariant(false);
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.refreshDependencyTree", async () => {
            await this.refresh();
        }));
        context.subscriptions.push(this.variants.onDidChangeActiveVariant(() => {
            if (this.followActiveVariant) {
                this.requestRefresh();
            }
        }));
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
            // Staying on the variant file is the whole point of the toggle, so ignore the editor.
            if (!this.followActiveVariant) {
                this.requestRefresh();
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
            if (this.isInTree(document.uri)) {
                this.requestRefresh();
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
            // Includes may appear & disappear as the user types, so follow the edits aswell.
            if (event.contentChanges.length > 0 && this.isInTree(event.document.uri)) {
                this.requestRefresh(refreshDebounceInMs);
            }
        }));

        this.requestRefresh();
    }

    dispose() {
        if (this.refreshTimeout !== undefined) {
            clearTimeout(this.refreshTimeout);
        }
    }

    // Refresh the tree without awaiting it. Successive calls within delayInMs are merged into one.
    public requestRefresh(delayInMs: number = 0) {
        if (this.refreshTimeout !== undefined) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.refreshTimeout = undefined;
            this.refresh();
        }, delayInMs);
    }

    public async refresh() {
        let refreshId = ++this.refreshId;
        let [root, message] = await this.requestDependencyTree();
        if (refreshId !== this.refreshId) {
            return; // A newer refresh was started in the meantime, drop this stale result.
        }
        this.root = root;
        this.tree.message = message;
        if (root) {
            let dependencies = new Set<string>;
            collectDependencies(root, dependencies);
            let count = `${dependencies.size} ${dependencies.size > 1 ? "dependencies" : "dependency"}`;
            let activeVariant = this.followActiveVariant ? this.variants.getActiveVariant() : null;
            this.tree.description = activeVariant ? `${activeVariant.name} - ${count}` : count;
        } else {
            this.tree.description = undefined;
        }
        this.onDidChangeTreeDataEmitter.fire();
    }

    // The file whose tree is displayed, either the active variant one or the active editor one.
    private getInspectedUri(): [vscode.Uri | null, string | undefined] {
        if (this.followActiveVariant) {
            let activeVariant = this.variants.getActiveVariant();
            if (!activeVariant) {
                return [null, "No active shader variant. Activate one from the variants view."];
            }
            if (!ShaderLanguageClient.isUriSupported(activeVariant.uri)) {
                return [null, undefined];
            }
            return [activeVariant.uri, undefined];
        }
        const activeTextEditor = vscode.window.activeTextEditor;
        if (!activeTextEditor || !ShaderLanguageClient.isTextDocumentSupported(activeTextEditor.document)) {
            return [null, undefined]; // Let the welcome view explain there is nothing to show.
        }
        return [activeTextEditor.document.uri, undefined];
    }

    private async requestDependencyTree(): Promise<[ShaderDependency | null, string | undefined]> {
        let [inspectedUri, inspectedMessage] = this.getInspectedUri();
        if (!inspectedUri) {
            return [null, inspectedMessage];
        }
        if (this.server.getServerStatus() !== ServerStatus.running) {
            return [null, "Server is not running."];
        }
        try {
            let dependencyTree = await this.server.sendRequest(dependencyTreeRequest, {
                uri: this.server.uriAsString(inspectedUri),
            });
            return [toShaderDependency(this.server, dependencyTree, []), undefined];
        } catch(error: any) {
            const message = error instanceof Error ? error.message : `${error}`;
            console.error("Failed to get dependency tree: ", message);
            return [null, `Failed to get dependency tree: ${message}`];
        }
    }

    private isInTree(uri: vscode.Uri): boolean {
        function isInNode(node: ShaderDependency): boolean {
            return node.uri.path === uri.path || node.includes.some(isInNode);
        }
        if (this.root !== null) {
            return isInNode(this.root);
        }
        // Without a tree to compare against, follow the inspected file so that one which failed
        // to resolve can still recover as the user edits it.
        let [inspectedUri, _message] = this.getInspectedUri();
        return inspectedUri !== null && inspectedUri.path === uri.path;
    }

    public getTreeItem(element: ShaderDependency): vscode.TreeItem {
        let isRoot = element === this.root;
        let item = new vscode.TreeItem(path.basename(element.uri.path), element.includes.length === 0
            ? vscode.TreeItemCollapsibleState.None
            : isRoot ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.command = {
            title: "Go to file",
            command: 'vscode.open',
            arguments: [
                element.uri,
            ]
        };
        item.resourceUri = element.uri;
        item.iconPath = vscode.ThemeIcon.File;
        item.description = element.isRecursive ? "already included" : path.dirname(vscode.workspace.asRelativePath(element.uri));
        item.tooltip = element.isRecursive
            ? `${element.uri.fsPath}\n\nThis file is already part of its own include chain, its includes are not listed again.`
            : element.uri.fsPath;
        item.contextValue = isRoot ? 'dependencyRoot' : 'dependency';
        return item;
    }

    public getChildren(element?: ShaderDependency): ShaderDependency[] {
        if (element) {
            return element.includes;
        } else {
            return this.root ? [this.root] : [];
        }
    }

    public getParent(element: ShaderDependency): ShaderDependency | undefined {
        function findParent(node: ShaderDependency): ShaderDependency | undefined {
            for (let include of node.includes) {
                if (include === element) {
                    return node;
                }
                let parent = findParent(include);
                if (parent) {
                    return parent;
                }
            }
            return undefined;
        }
        return this.root ? findParent(this.root) : undefined;
    }
}
