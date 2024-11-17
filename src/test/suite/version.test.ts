import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { getRootFolder } from './utils';

suite('Server version Test Suite', () => {
    test('Check windows server version', () => {
        const executablePath = path.join(getRootFolder(), "bin/shader_language_server.exe");
        let server = cp.spawn(executablePath, [
            "--version"
        ]);
        const version = vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
        const decoder = new TextDecoder('utf-8');
        server.stdout.on('data', (data) => {
            const text = decoder.decode(data);
            assert.equal(text, "shader_language_server v" + version, `Incompatible version: ${version}`);
        });
        server.stderr.on('data', (data) => {
            assert.fail(`stderr: ${data}`);
        });
        server.on('error', (data) => {
            assert.fail(`Error: ${data}`);
        });
    });
});