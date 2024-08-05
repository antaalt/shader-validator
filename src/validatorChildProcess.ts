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
        let debugOptions = { execArgv: [] };
        let serverOptions: ServerOptions = {
            command: executable.fsPath, 
            transport: TransportKind.stdio,
            options: {
                //detached: true,
                //shell: true,
            }
        };
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
            'shader-language-server',
            'Shader language Server',
            serverOptions,
            clientOptions
        );

        // Start the client. This will also launch the server
        await this.client.start();
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
