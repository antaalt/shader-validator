import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getRootFolder } from './utils';
import { ServerPlatform, ServerVersion } from '../../client';

function doesBinaryExist(binary : string) : boolean {
	let executablePath = path.join(getRootFolder(), "bin", binary);
	//console.log(`Checking presence of ${executablePath} from ${process.cwd()}`);
	return fs.existsSync(executablePath);
}

suite('Binary Test Suite', () => {
	vscode.window.showInformationMessage('Start all binary tests.');
	suiteTeardown(() => {
		vscode.window.showInformationMessage('All binary tests done!');
	});
	// Wasm target should always be here.
	test('Check wasm binary', () => {
		assert.ok(doesBinaryExist("wasi/shader-language-server.wasm"));
	});
	const platform = ServerVersion.getServerPlatform();
	if (platform == ServerPlatform.windows) {
		test('Check windows binary', () => {
			assert.ok(doesBinaryExist("windows/shader-language-server.exe"));
			// Dxc need these dll or it will crash.
			assert.ok(doesBinaryExist("windows/dxcompiler.dll"));
			assert.ok(doesBinaryExist("windows/dxil.dll"));
		});
	}
	if (platform == ServerPlatform.linux) {
		test('Check linux binary', () => {
			assert.ok(doesBinaryExist("linux/shader-language-server"));
			// Dxc need these dll or it will crash.
			assert.ok(doesBinaryExist("linux/libdxcompiler.so"));
			assert.ok(doesBinaryExist("linux/libdxil.so"));
		});
	}
});