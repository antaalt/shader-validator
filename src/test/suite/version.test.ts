import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
import { getRootFolder } from './utils';
import { ServerVersion } from '../../client';

suite('Server version Test Suite', () => {
    test('Check server version', () => {
        let serverVersion = new ServerVersion(vscode.Uri.parse(getRootFolder()));
        assert.ok(fs.existsSync(serverVersion.path.fsPath), `Failed to find ${serverVersion.path}`);
        let server = cp.spawn(serverVersion.path.fsPath, [
            "--version"
        ]);
        const expectedVersion = ServerVersion.getBundledVersion();
        const decoder = new TextDecoder('utf-8');
        server.stdout.on('data', (data) => {
            const text = decoder.decode(data);
            assert.equal(text.trim(), expectedVersion.trim(), `Incompatible version, got ${text}, expected: ${expectedVersion}`);
        });
        server.stderr.on('data', (data) => {
            assert.fail(`stderr: ${data}`);
        });
        server.on('error', (data) => {
            assert.fail(`Error: ${data}`);
        });
    });
});