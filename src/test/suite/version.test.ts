import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
import { getRootFolder } from './utils';
import { getPlatformBinaryUri, getServerPlatform } from '../../validator';

suite('Server version Test Suite', () => {
    test('Check server version', () => {
        let platform = getServerPlatform();
        let executableUri = getPlatformBinaryUri(vscode.Uri.parse(getRootFolder()), platform);
        assert.ok(fs.existsSync(executableUri.fsPath), `Failed to find ${executableUri}`);
        let server = cp.spawn(executableUri.fsPath, [
            "--version"
        ]);
        const version = vscode.extensions.getExtension('antaalt.shader-validator')!.packageJSON.server_version;
        const decoder = new TextDecoder('utf-8');
        server.stdout.on('data', (data) => {
            const text = decoder.decode(data);
            assert.equal(text, "shader-language-server v" + version, `Incompatible version: ${version}`);
        });
        server.stderr.on('data', (data) => {
            assert.fail(`stderr: ${data}`);
        });
        server.on('error', (data) => {
            assert.fail(`Error: ${data}`);
        });
    });
});