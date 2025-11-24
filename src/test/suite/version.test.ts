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
        let server = cp.spawnSync(serverVersion.path.fsPath, [
            "--version"
        ], {
            encoding: "utf-8"
        });
        const expectedVersion = ServerVersion.getBundledVersion();
        assert.equal(server.stdout.trim(), expectedVersion.trim(), `Incompatible version, got ${server.stdout}, expected: ${expectedVersion}`);
        assert.ok(server.stderr.length === 0);
        assert.ok(server.status === 0);
    });
});