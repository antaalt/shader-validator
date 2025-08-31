import * as vscode from "vscode";
import { ServerStatus, ShaderLanguageClient } from "../client";


export class ShaderStatusBar {
    private statusBar: vscode.StatusBarItem;
    private server: ShaderLanguageClient;

    constructor(context: vscode.ExtensionContext, server: ShaderLanguageClient) {
        this.server = server;
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBar.text = `shader-validator`;
        this.updateStatusBar();
        this.server.onStatusChanged(_ => {
            this.updateStatusBar();
        })
        this.statusBar.show();

        context.subscriptions.push(this.statusBar);
    }

    updateStatusBar() {
        const serverStatus = this.server.getServerStatus();

        let statusString = null;
        let statusCommand = null;
        switch (serverStatus) {
            case ServerStatus.error:
                this.statusBar.color = new vscode.ThemeColor("statusBarItem.errorForeground");
                this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                this.statusBar.text = "$(debug-restart) shader-validator";
                this.statusBar.command = "shader-validator.restartServer";
                statusString = `Server erroring. [View logs](command:shader-validator.showLogs "Open the server logs").`;
                statusCommand = `[$(debug-restart) Restart Server](command:shader-validator.restartServer "Restart the server")`;
                break;
            case ServerStatus.running:
                this.statusBar.color = undefined;
                this.statusBar.backgroundColor = undefined;
                this.statusBar.text = "shader-validator";
                this.statusBar.command = undefined;
                statusString = `Server running.`;
                statusCommand = `[$(debug-stop) Stop Server](command:shader-validator.stopServer "Stop the server")\n\n` +
                    `[$(debug-restart) Restart Server](command:shader-validator.restartServer "Restart the server")`;
                break;
            case ServerStatus.stopped:
                this.statusBar.color = new vscode.ThemeColor("statusBarItem.warningForeground");
                this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
                this.statusBar.command = "shader-validator.startServer";
                this.statusBar.text = "$(play-circle) shader-validator";
                statusString = `Server stopped.`;
                statusCommand = `[$(debug-start) Start Server](command:shader-validator.startServer "Start the server")`;
                break;
            default:
                break;
        }

        const serverVersion = this.server.getServerVersion();
        const serverPath = this.server.getServerPath().path;
        this.statusBar.tooltip = new vscode.MarkdownString(
            `**${serverVersion}**\n\n` +
            `${serverPath}\n\n` +
            (statusString ? `${statusString}\n\n` : ``) +
            `---\n\n` +
            // TODO: could add memory usage, file in cache...
            `[$(settings) Open Settings](command:workbench.action.openSettings?%22shader-validator%22 "Open the extension setting page")\n\n` +
            `[$(terminal) Open Server Logs](command:shader-validator.showLogs "Open the server logs")\n\n` +
            (statusCommand ? `${statusCommand}\n\n` : ``) +
            `---\n\n` +
            `[$(link-external) Extension issues](command:vscode.open?%22https://github.com/antaalt/shader-validator/issues%22 "See extension issues on Github (https://github.com/antaalt/shader-validator/issues)")` +
            `&nbsp;&nbsp;&nbsp;&nbsp;` + // Space betwen links
            `[$(link-external) Server issues](command:vscode.open?%22https://github.com/antaalt/shader-sense/issues%22 "See server issues on Github (https://github.com/antaalt/shader-sense/issues)")`,
            true
        );
        this.statusBar.tooltip.isTrusted = true;
    }

    dispose() {
        // Nothing to dispose
    }
}