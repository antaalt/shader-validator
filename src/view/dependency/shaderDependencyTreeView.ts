import * as vscode from 'vscode';
import path from 'path';
import { ServerStatus, ShaderLanguageClient } from '../../client';
import { DependencyTreeNode, dependencyTreeRequest } from '../../request';

// Delay before refreshing the tree after an edit, to avoid requesting the server on every keystroke.
const refreshDebounceInMs : number = 500;

export interface ShaderDependency {
    uri: vscode.Uri,
    includes: ShaderDependency[],
    // Set when the file is already one of its own ancestors. Its includes are not expanded again.
    isRecursive: boolean,
}

// The server sends plain file system paths, not uris. Rebuild them with the scheme of the workspace
// so that the tree keeps working on the web, where there is no file system behind the workspace.
function resolveDependencyUri(filePath: string): vscode.Uri {
    let fileUri = vscode.Uri.file(filePath);
    let workspaceFolder = vscode.workspace.workspaceFolders?.at(0);
    if (workspaceFolder && workspaceFolder.uri.scheme !== 'file') {
        return workspaceFolder.uri.with({ path: fileUri.path });
    }
    return fileUri;
}

function toShaderDependency(node: DependencyTreeNode, ancestors: string[]): ShaderDependency {
    // Include guards make a file including itself indirectly perfectly legal, so stop expanding
    // instead of recursing forever.
    let isRecursive = ancestors.includes(node.path);
    return {
        uri: resolveDependencyUri(node.path),
        includes: isRecursive ? [] : node.includes.map(include => toShaderDependency(include, [...ancestors, node.path])),
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
    private tree: vscode.TreeView<ShaderDependency>;
    private root: ShaderDependency | null = null;
    // Increased on every refresh so that a slow request cannot overwrite the result of a newer one.
    private refreshId: number = 0;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined = undefined;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.server = server;
        this.tree = vscode.window.createTreeView<ShaderDependency>("shader-validator-dependencies", {
            treeDataProvider: this
        });
        context.subscriptions.push(this.tree);

        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.refreshDependencyTree", async () => {
            await this.refresh();
        }));
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
            this.requestRefresh();
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
            this.tree.description = `${dependencies.size} ${dependencies.size > 1 ? "dependencies" : "dependency"}`;
        } else {
            this.tree.description = undefined;
        }
        this.onDidChangeTreeDataEmitter.fire();
    }

    private async requestDependencyTree(): Promise<[ShaderDependency | null, string | undefined]> {
        const activeTextEditor = vscode.window.activeTextEditor;
        if (!activeTextEditor || !ShaderLanguageClient.isTextDocumentSupported(activeTextEditor.document)) {
            return [null, undefined]; // Let the welcome view explain there is nothing to show.
        }
        if (this.server.getServerStatus() !== ServerStatus.running) {
            return [null, "Server is not running."];
        }
        try {
            let dependencyTree = await this.server.sendRequest(dependencyTreeRequest, {
                uri: this.server.uriAsString(activeTextEditor.document.uri),
            });
            return [toShaderDependency(dependencyTree, []), undefined];
        } catch(error: any) {
            const message = error instanceof Error ? error.message : `${error}`;
            console.error("Failed to get dependency tree: ", message);
            return [null, `Failed to get dependency tree: ${message}`];
        }
    }

    private isInTree(uri: vscode.Uri): boolean {
        // An edit in the active file is relevant even if we failed to compute its tree.
        if (vscode.window.activeTextEditor?.document.uri.path === uri.path) {
            return true;
        }
        function isInNode(node: ShaderDependency): boolean {
            return node.uri.path === uri.path || node.includes.some(isInNode);
        }
        return this.root !== null && isInNode(this.root);
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
