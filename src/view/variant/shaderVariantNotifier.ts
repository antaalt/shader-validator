import * as vscode from 'vscode';
import { resolveVSCodeVariables, ShaderLanguageClient } from '../../client';
import { ShaderStage, ShaderVariant, ShaderVariantFile, UriMap } from './variant';
import { DocumentUri, ProtocolNotificationType, ProtocolRequestType, TextDocumentIdentifier, TextDocumentRegistrationOptions } from 'vscode-languageclient';

export interface ShaderVariantSerialized {
    url: DocumentUri,
    shadingLanguage: string,
    entryPoint: string,
    stage: string | null,
    defines: Object,
    includes: string[],
}

export type ShaderEntryPoint = {
    entryPoint: string,
    range: vscode.Range,
};

function shaderVariantToSerialized(url: DocumentUri, languageId: string, e: ShaderVariant) : ShaderVariantSerialized {
    return {
        url: url,
        shadingLanguage: languageId,
        entryPoint: e.name,
        stage: (e.stage.stage === ShaderStage.auto) ? null : ShaderStage[e.stage.stage],
        defines: Object.fromEntries(e.defines.defines.map(e => [e.label, e.value])),
        includes: e.includes.includes.map(e => resolveVSCodeVariables(e.include))
    };
}

// Custom LSP notification (client -> server), method `textDocument/didChangeShaderVariant`.
//
// This is not part of standard LSP. We send it to tell the server which "shader variant" a file
// should be validated with. A variant pins a validation context: an entry point, an optional
// shader stage, preprocessor defines and include paths (see `ShaderVariantSerialized`). The
// server keeps the last one it receives as the active variant and uses it when validating and
// resolving symbols. Sending `{ shaderVariant: null }` clears the active variant.
//
// This is the reference client for the notification. When implementing it:
// - Use the exact method string `textDocument/didChangeShaderVariant` (see below). It must match
//   the server declaration (`DidChangeShaderVariant::METHOD` in shader_variant.rs).
// - The payload is serialized as JSON, so field names must match the server's camelCase struct
//   (`shaderVariant`, `entryPoint`, `shadingLanguage`, ...); see `shaderVariantToSerialized`.
// - Re-send the notification every time the user activates, edits or clears a variant; the
//   server always replaces the active variant with the payload it receives (see
//   `notifyVariantChanged`).
//
// Note: the server still accepts an older, deprecated payload shape for backward compatibility,
// but new clients should only send the shape documented here.
interface DidChangeShaderVariantParams {
    // The variant to make active, or `null` to clear it. When cleared, the server drops the
    // pinned context and validates the file without a specific variant.
    shaderVariant: ShaderVariantSerialized | null
}
interface DidChangeShaderVariantRegistrationOptions extends TextDocumentRegistrationOptions {}

const didChangeShaderVariantNotification = new ProtocolNotificationType<DidChangeShaderVariantParams, DidChangeShaderVariantRegistrationOptions>('textDocument/didChangeShaderVariant');

// Request from server to send file active variant.
interface ShaderVariantParams extends TextDocumentIdentifier {}
interface ShaderVariantRegistrationOptions extends TextDocumentRegistrationOptions {}

interface ShaderVariantResponse {
    shaderVariant: ShaderVariantSerialized | null,
}
const shaderVariantRequest = new ProtocolRequestType<ShaderVariantParams, ShaderVariantResponse, never, void, ShaderVariantRegistrationOptions>('textDocument/shaderVariant');

export class ShaderVariantNotifier {
    private activeVariant: ShaderVariant | null;
    private server: ShaderLanguageClient;
    private decorator: Map<string, vscode.TextEditorDecorationType>;
    // Async symbol loading
    private shaderEntryPointList: UriMap<ShaderEntryPoint[]>;
    private asyncGoToShaderEntryPoint: UriMap<string>;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.decorator = new Map;
        this.shaderEntryPointList = new UriMap;
        this.asyncGoToShaderEntryPoint = new UriMap;
        this.server = server;
        this.activeVariant = null;
        
        const supportedLangIds = ShaderLanguageClient.getSupportedLangId();
        for (var supportedLangId of supportedLangIds) {
            this.decorator.set(supportedLangId, vscode.window.createTextEditorDecorationType({
                // Icon
                gutterIconPath: context.asAbsolutePath(`./res/icons/${supportedLangId}-icon.svg`),
                gutterIconSize: "contain",
                // Minimap
                overviewRulerColor: "rgb(0, 174, 255)",
                overviewRulerLane: vscode.OverviewRulerLane.Full,
                rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
                // Border
                borderWidth: '1px',
                borderStyle: 'solid',
            }));
        }
        // Prepare entry point symbol cache
        for (let editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.shaderEntryPointList.set(editor.document.uri, []);
            }
        }
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (document.uri.scheme === 'file') {
                this.shaderEntryPointList.set(document.uri, []);
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
            this.shaderEntryPointList.delete(document.uri);
        }));
        context.subscriptions.push(vscode.workspace.onDidRenameFiles(document => {
            for (const fileObj of document.files) {
                const { oldUri, newUri } = fileObj;
                // To update the key in a Map, you need to remove the old key and add the new one.
                const oldPath = oldUri;
                const newPath = newUri;
                // Update entry point and async maps
                const entryPoints = this.shaderEntryPointList.get(oldPath);
                if (entryPoints) {
                    this.shaderEntryPointList.delete(oldPath);
                    this.shaderEntryPointList.set(newPath, entryPoints);
                }
                const asyncEntryPoint = this.asyncGoToShaderEntryPoint.get(oldUri);
                if (asyncEntryPoint) {
                    this.asyncGoToShaderEntryPoint.delete(oldUri);
                    this.asyncGoToShaderEntryPoint.set(newUri, asyncEntryPoint);
                }
                this.shaderEntryPointList;
                this.asyncGoToShaderEntryPoint;
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("shader-validator.gotoShaderEntryPoint", (uri: vscode.Uri, entryPointName: string) => {
            // sometimes, its goes in random place in file... 
            // TODO: Should use regex & read diag region instead.
            //let diagnostic = vscode.languages.getDiagnostics().find(([diagUri, diags]) => diagUri === uri);
            
            this.goToShaderEntryPoint(uri, entryPointName, true);
        }));
    }
    notifyVariantChanged(variantFile: ShaderVariantFile, activeVariant: ShaderVariant | null) {
        function capitalizeFirstLetter(str: string): string {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }
        this.activeVariant = activeVariant;
        // Notify server of change.
        if (activeVariant) {
            console.assert(activeVariant.isActive);
            // Open document to get language ID.
            // This does not open the document in the editor, only internally.
            vscode.workspace.openTextDocument(activeVariant.uri).then(doc => {
                this.server.sendNotification(didChangeShaderVariantNotification, {
                    // Need this check again here because its async
                    shaderVariant: activeVariant ? shaderVariantToSerialized(
                        this.server.uriAsString(activeVariant.uri), 
                        capitalizeFirstLetter(doc.languageId), // Server expect it with capitalized first letter.
                        activeVariant
                    ) : null,
                });
                // Symbols might have changed, so request them as we might change context
                this.requestDocumentSymbol(variantFile.uri);
            });
        } else {
            this.server.sendNotification(didChangeShaderVariantNotification, {
                shaderVariant: null,
            });
            this.requestDocumentSymbol(variantFile.uri);
        }
    }
    private requestDocumentSymbol(uri: vscode.Uri) {
        // TODO: should request inlay hint aswell.
        // This one seems to get symbol from cache without requesting the server...
        //vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", file.uri);
        // This one works, but result is not intercepted by vscode & updated...
        //this.client.sendRequest(DocumentSymbolRequest.type, {
        //    textDocument: {
        //        uri: this.client.code2ProtocolConverter.asUri(file.uri),
        //    }
        //});
        // We have to rely on a dirty hack instead.
        // Need to check this does not break anything
        // Dirty hack to trigger document symbol update
        // Ideally, it should retrigger dependencies aswell.
        // See https://github.com/microsoft/vscode/issues/108722 (Old one https://github.com/microsoft/vscode/issues/71454)

        // Only trigger it if requested by user as it may be a bit invasive.
        let updateSymbolsOnVariantUpdate = vscode.workspace.getConfiguration("shader-validator").get<boolean>("updateSymbolsOnVariantUpdate");
        if (updateSymbolsOnVariantUpdate) {
            let visibleEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.path === uri.path);
            if (visibleEditor) {
                let editor = visibleEditor;
                editor.edit(editBuilder => {
                    for (let iLine = 0; iLine < editor.document.lineCount; iLine++) {
                        // Find first non-empty line to avoid crashing on empty line with negative position.
                        let line = editor.document.lineAt(iLine);
                        if (line.text.length > 0) {
                            const text = line.text;
                            const c = line.range.end.character;
                            // Remove last character of first line and add it back.
                            editBuilder.delete(new vscode.Range(iLine, c-1, iLine, c));
                            editBuilder.insert(new vscode.Position(iLine, c), text[c-1]);
                            break;
                        }
                    }
                    // All empty lines means no symbols !
                });
            }
        }
    }
    public onDocumentSymbols(uri: vscode.Uri, symbols: vscode.DocumentSymbol[]) {
        // TODO:TREE: need to recurse child as well.
        this.shaderEntryPointList.set(uri, symbols.filter(symbol => symbol.kind === vscode.SymbolKind.Function).map(symbol => {
            return {
                entryPoint: symbol.name, 
                range: symbol.selectionRange
            };
        }));
        // Solve async request for goto.
        let entryPoint = this.asyncGoToShaderEntryPoint.get(uri);
        if (entryPoint) {
            this.asyncGoToShaderEntryPoint.delete(uri);
            this.goToShaderEntryPoint(uri, entryPoint, false);
        }
        this.updateDecorations();
    }
    private goToShaderEntryPoint(uri: vscode.Uri, entryPointName: string, defer: boolean) {
        let shaderEntryPointList = this.shaderEntryPointList.get(uri);
        let entryPoint = shaderEntryPointList?.find(e => e.entryPoint === entryPointName);
        // TOOD: Could instead regex + check regions via vscode.
        if (entryPoint) {
            vscode.commands.executeCommand('vscode.open', uri, <vscode.TextDocumentShowOptions>{
                selection: entryPoint.range
            });
        } else {
            let editor = vscode.window.visibleTextEditors.find(e => e.document.uri === uri);
            if (editor || !defer) {
                // Already opened, but no entry point found.
                vscode.window.showWarningMessage(`Failed to find entry point ${entryPointName} for file ${vscode.workspace.asRelativePath(uri)}`);
            } else {
                // Store request & open the file. Resolve goto on document request
                this.asyncGoToShaderEntryPoint.set(uri, entryPointName);
                vscode.commands.executeCommand('vscode.open', uri, <vscode.TextDocumentShowOptions>{});
            }
        }
    }
    private getDecorator(langId: string) : vscode.TextEditorDecorationType {
        // Use decorator or a default one.
        return this.decorator.get(langId) || vscode.window.createTextEditorDecorationType({
            // Minimap
            overviewRulerColor: "rgb(0, 174, 255)",
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            // Border
            borderWidth: '1px',
            borderStyle: 'solid',
        });
    }
    private updateDecoration(editor: vscode.TextEditor) {
        let entryPoints = this.shaderEntryPointList.get(editor.document.uri);

        if (entryPoints) {
            if (this.activeVariant) {
                let found = false;
                for (let entryPoint of entryPoints) {
                    if (entryPoint.entryPoint === this.activeVariant.name) {
                        let decorations : vscode.DecorationOptions[]= [];
                        decorations.push({ range: entryPoint.range, hoverMessage: this.activeVariant.name });
                        editor.setDecorations(this.getDecorator(editor.document.languageId), decorations);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.info("Entry point not found in ", entryPoints);
                    editor.setDecorations(this.getDecorator(editor.document.languageId), []);
                }
            } else {
                console.info("No active variant ", entryPoints);
                editor.setDecorations(this.getDecorator(editor.document.languageId), []);
            }
        } else {
            editor.setDecorations(this.getDecorator(editor.document.languageId), []);
        }
    }
    updateDecorations(uri?: vscode.Uri) {
        for (let editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme === 'file') {
                this.updateDecoration(editor);
            }
        }
    }
}