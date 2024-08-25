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
    DidChangeConfigurationNotification,
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
        let clientOptions: LanguageClientOptions = {
            // Register the server for shader documents
            documentSelector: [
                { scheme: 'file', language: 'hlsl' },
                { scheme: 'file', language: 'glsl' },
                { scheme: 'file', language: 'wgsl' },
            ]
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
        await this.client?.sendNotification(DidChangeConfigurationNotification.type, {
            settings: "", // Required as server expect some empty params
        });
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async (event : vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration("shader-validator"))
                {
                    await this.client?.sendNotification(DidChangeConfigurationNotification.type, {
                        settings: "",
                    });
                }
            })
        );
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
