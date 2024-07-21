import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function doesBinaryExist(binary : string) : boolean {
	let binFolder = "../../bin/";
	let executablePath = path.join(binFolder, binary);
	return fs.existsSync(executablePath);
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Check wasm binary', () => {
		assert.ok(doesBinaryExist("shader_language_server.wasm"));
	});
	test('Check windows binary', () => {
		assert.ok(doesBinaryExist("shader_language_server.exe"));
	});
	test('Check dxc dependencies', () => {
		// Dxc need these dll or it will crash.
		assert.ok(doesBinaryExist("dxcompiler.dll"));
		assert.ok(doesBinaryExist("dxil.dll"));
	});
});
