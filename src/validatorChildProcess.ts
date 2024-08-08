import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";

import {
    RPCGetFileTreeRequest,
    RPCGetFileTreeResponse,
    RPCResponse,
    RPCUnknownError,
    RPCValidateFileRequest,
    RPCValidationResponse,
} from "./rpc";


import {
    LanguageClient,
    LanguageClientOptions,
    ProtocolNotificationType0,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

import { getBaseName, getBinaryPath, ValidationParams, Validator } from "./validator";
import path from "path";
import os from "os";

export class ValidatorChildProcess implements Validator {
    client: LanguageClient | null;

    constructor()
    {
        this.client = null;
    }
    dispose()
    {        
        if (this.client)
        {
            this.client.stop().then(_ => {}, e => {
                console.error(e);
            });
        }
    }
    async launch(context: vscode.ExtensionContext)
    {
        const executable = getBinaryPath(context, 'shader_language_server.exe');
        let serverOptions: ServerOptions = {
            run: {
                command: executable.fsPath, 
                transport: TransportKind.stdio
            },
            debug:{
                command: executable.fsPath, 
                transport: TransportKind.stdio,
                options: {
                    env: {
                        "RUST_LOG": "shader_language_server=trace",
                    }
                }
            }
        };
        // Need to send config somehow
        let clientOptions: LanguageClientOptions = {
            // Register the server for plain text documents
            documentSelector: [
                { scheme: 'file', language: 'hlsl' },
                { scheme: 'file', language: 'glsl' },
                { scheme: 'file', language: 'wgsl' },
            ],
            synchronize: {
                // Notify the server about file changes to files contained in the workspace
                fileEvents: [
                    // TODO: handle variant extension
                    vscode.workspace.createFileSystemWatcher('**/.hlsl'),
                    vscode.workspace.createFileSystemWatcher('**/.glsl'),
                    vscode.workspace.createFileSystemWatcher('**/.wgsl'),
                ]
            }
        };

        this.client = new LanguageClient(
            'shader-validator',
            'Shader language Server',
            serverOptions,
            clientOptions,
            context.extensionMode === vscode.ExtensionMode.Development 
        );

        // Start the client. This will also launch the server
        await this.client.start();
        // Send configuration to server.
        this.sendConfig();
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event : vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration("shader-validator"))
                {
                    this.sendConfig();
                }
            })
        );
    }

    sendConfig() {
        
        const config = vscode.workspace.getConfiguration("shader-validator");
        const validateOnSave = config.get<boolean>("validateOnSave", true);
        const validateOnType = config.get<boolean>("validateOnType", true);
        const includes = config.get<string[]>("includes", []);
        const definesObject = config.get<Object>("defines", {});
        let defines : {[key: string]: string} = {};
        for (const [key, value] of Object.entries(definesObject)) {
            defines[key] = value;
        }
        console.log("Sending configuration", includes, defines);
        this.client?.sendNotification("workspace/didChangeConfiguration", {
            "includes": includes,
            "defines": defines,
            "validateOnType": validateOnType,
            "validateOnSave": validateOnSave,
        });
    }

    async getFileTree(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params: ValidationParams,
        cb: (data: RPCResponse<RPCGetFileTreeResponse | null> | null) => void
    ) {
    }

    async validateFile(
        document: vscode.TextDocument,
        shadingLanguage: string,
        params: ValidationParams,
        useTemporary: boolean,
        cb: (data: RPCResponse<RPCValidationResponse> | null) => void
    ) {
    }
}
