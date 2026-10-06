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
    // Only set on filtered nodes. Changes with the filter so that the tree expands the new matches
    // instead of restoring the expansion state of the previous filter.
    id?: string,
}

// Displayed above the root, holds the filter actions and reminds what is hidden while filtering.
interface ShaderFilter {
    filter: string,
    matchCount: number,
}

type ShaderDependencyTreeElement = ShaderDependency | ShaderFilter;

function isShaderFilter(element: ShaderDependencyTreeElement): element is ShaderFilter {
    return 'filter' in element;
}

function toShaderDependency(server: ShaderLanguageClient, node: DependencyTreeNode, ancestors: string[]): ShaderDependency {
    // Include guards make a file including itself indirectly perfectly legal, so stop expanding
    // instead of recursing forever.
    let isRecursive = ancestors.includes(node.uri);
    return {
        // Uris live in the server namespace, which is the mounted one under WASI, so they have to
        // go through the client converter, the exact inverse of the uriAsString used to request it.
        uri: server.stringAsUri(node.uri),
        includes: isRecursive ? [] : node.includes.map(include => toShaderDependency(server, include, [...ancestors, node.uri])),
        isRecursive: isRecursive,
    };
}

// Keep the nodes matching the filter along with their ancestors, so that the path to each match stays visible.
function filterDependency(node: ShaderDependency, filter: string, id: string): ShaderDependency | null {
    let includes: ShaderDependency[] = [];
    node.includes.forEach((include, index) => {
        let filteredInclude = filterDependency(include, filter, `${id}/${index}`);
        if (filteredInclude) {
            includes.push(filteredInclude);
        }
    });
    if (includes.length === 0 && !matchesFilter(node.uri, filter)) {
        return null;
    }
    return {
        uri: node.uri,
        includes: includes,
        isRecursive: node.isRecursive,
        id: id,
    };
}

function matchesFilter(uri: vscode.Uri, filter: string): boolean {
    return vscode.workspace.asRelativePath(uri).toLowerCase().includes(filter);
}

function collectMatches(node: ShaderDependency, filter: string, matches: Set<string>) {
    if (matchesFilter(node.uri, filter)) {
        matches.add(node.uri.toString());
    }
    for (let include of node.includes) {
        collectMatches(include, filter, matches);
    }
}

function collectDependencies(node: ShaderDependency, dependencies: Set<string>) {
    for (let include of node.includes) {
        dependencies.add(include.uri.toString());
        collectDependencies(include, dependencies);
    }
}

export class ShaderDependencyTreeDataProvider implements vscode.TreeDataProvider<ShaderDependencyTreeElement> {

    private onDidChangeTreeDataEmitter: vscode.EventEmitter<ShaderDependencyTreeElement | undefined | void> = new vscode.EventEmitter<ShaderDependencyTreeElement | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ShaderDependencyTreeElement | undefined | void> = this.onDidChangeTreeDataEmitter.event;

    private server: ShaderLanguageClient;
    private variants: ShaderVariantTreeDataProvider;
    private tree: vscode.TreeView<ShaderDependencyTreeElement>;
    private root: ShaderDependency | null = null;
    // The root actually displayed, which is the filtered version of root when a filter is set.
    private displayedRoot: ShaderDependency | null = null;
    // The node displayed above the root whenever there is a tree.
    private filterNode: ShaderFilter | null = null;
    // Message from the last refresh, displayed unless the filter hides everything.
    private message: string | undefined = undefined;
    private filter: string = "";
    // Increased on every filter change to give filtered nodes fresh ids.
    private filterId: number = 0;
    // When set, inspect the active variant file instead of following the active editor.
    private followActiveVariant: boolean;
    // Document of the last focused file editor. Focusing the terminal or the output panel changes the
    // active editor aswell, so it cannot be used directly without the tree going away.
    private editorDocument: vscode.TextDocument | null = null;
    // Increased on every refresh so that a slow request cannot overwrite the result of a newer one.
    private refreshId: number = 0;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined = undefined;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient, variants: ShaderVariantTreeDataProvider) {
        this.server = server;
        this.variants = variants;
        this.followActiveVariant = context.workspaceState.get<boolean>(followActiveVariantKey, false);
        this.tree = vscode.window.createTreeView<ShaderDependencyTreeElement>("shader-validator-dependencies", {
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
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.filterDependencyTree", () => {
            this.showFilterInput();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.clearDependencyTreeFilter", () => {
            this.setFilter("");
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.revealActiveFileInDependencyTree", async () => {
            await this.revealActiveFile();
        }));
        context.subscriptions.push(this.variants.onDidChangeActiveVariant(() => {
            if (this.followActiveVariant) {
                this.requestRefresh();
            }
        }));
        this.updateEditorDocument(vscode.window.activeTextEditor);
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (this.updateEditorDocument(editor) && !this.followActiveVariant) {
                // Staying on the variant file is the whole point of the toggle, so ignore the editor.
                this.requestRefresh();
            }
        }));
        context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs((event) => {
            // The tree outlives the focus of its editor, but not the editor itself.
            if (this.editorDocument && event.closed.length > 0 && !this.isOpenedInTab(this.editorDocument.uri)) {
                this.editorDocument = null;
                if (!this.followActiveVariant) {
                    this.requestRefresh();
                }
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
        this.message = message;
        this.updateDisplayedTree();
    }

    private showFilterInput() {
        let input = vscode.window.createInputBox();
        input.title = "Filter dependencies";
        input.placeholder = "Part of the file path to search for";
        input.value = this.filter;
        // Filtering is done locally, so the tree can follow every keystroke.
        input.onDidChangeValue(value => this.setFilter(value));
        input.onDidAccept(() => input.hide());
        input.onDidHide(() => input.dispose());
        input.show();
    }

    private setFilter(filter: string) {
        filter = filter.trim().toLowerCase();
        if (filter === this.filter) {
            return;
        }
        this.filter = filter;
        this.filterId++;
        this.updateDisplayedTree();
    }

    private updateDisplayedTree() {
        let root = this.root;
        if (root && this.filter.length > 0) {
            let matches = new Set<string>;
            collectMatches(root, this.filter, matches);
            this.displayedRoot = filterDependency(root, this.filter, `filter-${this.filterId}`);
            this.filterNode = { filter: this.filter, matchCount: matches.size };
        } else {
            this.displayedRoot = root;
            // Without a tree, there is nothing to filter and the welcome view must stay visible.
            this.filterNode = root ? { filter: "", matchCount: 0 } : null;
        }
        this.tree.message = this.message;
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
        if (!this.editorDocument || !ShaderLanguageClient.isTextDocumentSupported(this.editorDocument)) {
            return [null, undefined]; // Let the welcome view explain there is nothing to show.
        }
        return [this.editorDocument.uri, undefined];
    }

    // Returns true when the followed editor changed.
    private updateEditorDocument(editor: vscode.TextEditor | undefined): boolean {
        // No editor means focus went to a panel such as the terminal, and output or diff views use
        // their own schemes. Keep following the last file in both cases.
        if (!editor || !ShaderLanguageClient.isUriSupported(editor.document.uri)) {
            return false;
        }
        if (this.editorDocument === editor.document) {
            return false;
        }
        this.editorDocument = editor.document;
        return true;
    }

    private isOpenedInTab(uri: vscode.Uri): boolean {
        return vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
            tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
        ));
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

    // Select the active editor file in the tree. A file can be included from several places, so
    // revealing again while one of them is selected moves on to the next one.
    private async revealActiveFile() {
        if (!this.editorDocument) {
            vscode.window.showInformationMessage("No file is opened in the active editor.");
            return;
        }
        let uri = this.editorDocument.uri;
        function collectOccurrences(node: ShaderDependency, occurrences: ShaderDependency[]) {
            if (node.uri.path === uri.path) {
                occurrences.push(node);
            }
            for (let include of node.includes) {
                collectOccurrences(include, occurrences);
            }
        }
        let occurrences: ShaderDependency[] = [];
        if (this.displayedRoot) {
            collectOccurrences(this.displayedRoot, occurrences);
        }
        if (occurrences.length === 0) {
            let fileName = path.basename(uri.path);
            vscode.window.showInformationMessage(this.filter.length > 0 && this.isInTree(uri)
                ? `${fileName} is hidden by the current filter.`
                : `${fileName} is not part of the dependency tree.`);
            return;
        }
        let selected = this.tree.selection.length > 0 ? this.tree.selection[0] : undefined;
        let selectedIndex = occurrences.findIndex(occurrence => occurrence === selected);
        let next = occurrences[(selectedIndex + 1) % occurrences.length];
        await this.tree.reveal(next, { select: true, focus: true, expand: false });
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

    public getTreeItem(element: ShaderDependencyTreeElement): vscode.TreeItem {
        if (isShaderFilter(element)) {
            return this.getFilterTreeItem(element);
        }
        let isRoot = element === this.displayedRoot;
        let isFiltered = this.filter.length > 0;
        let label = path.basename(element.uri.path);
        let matchStart = isFiltered ? label.toLowerCase().indexOf(this.filter) : -1;
        let item = new vscode.TreeItem({
            label: label,
            highlights: matchStart >= 0 ? [[matchStart, matchStart + this.filter.length]] : undefined,
        }, element.includes.length === 0
            ? vscode.TreeItemCollapsibleState.None
            // Expand everything while filtering, the filter already keeps only the paths leading to a match.
            : isRoot || isFiltered ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.id = element.id;
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

    private getFilterTreeItem(element: ShaderFilter): vscode.TreeItem {
        let command: vscode.Command = {
            title: "Edit filter",
            command: 'shader-validator.filterDependencyTree',
        };
        if (element.filter.length === 0) {
            let item = new vscode.TreeItem("Filter dependencies...", vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('filter');
            item.tooltip = "Click to filter the dependencies by file path.";
            item.command = command;
            item.contextValue = 'dependencyFilter';
            return item;
        }
        let item = new vscode.TreeItem(`"${element.filter}"`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('filter-filled');
        item.description = element.matchCount === 0
            ? "no match"
            : `${element.matchCount} ${element.matchCount > 1 ? "matches" : "match"}`;
        item.tooltip = `Dependencies filtered by "${element.filter}". Click to edit the filter.`;
        item.command = command;
        item.contextValue = 'dependencyFilterActive';
        return item;
    }

    public getChildren(element?: ShaderDependencyTreeElement): ShaderDependencyTreeElement[] {
        if (element) {
            return isShaderFilter(element) ? [] : element.includes;
        }
        let children: ShaderDependencyTreeElement[] = [];
        if (this.filterNode) {
            children.push(this.filterNode);
        }
        if (this.displayedRoot) {
            children.push(this.displayedRoot);
        }
        return children;
    }

    public getParent(element: ShaderDependencyTreeElement): ShaderDependency | undefined {
        if (isShaderFilter(element)) {
            return undefined;
        }
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
        return this.displayedRoot ? findParent(this.displayedRoot) : undefined;
    }
}
