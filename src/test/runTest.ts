import * as path from 'path';

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { runTests as runTestsWeb } from '@vscode/test-web';
import * as cp from 'child_process';

async function native(extensionDevelopmentPath: string, extensionTestsPath: string) {
	try {
		// Spawn vscode ourselve to install extension we are relying on.
		const vscodeExecutablePath = await downloadAndUnzipVSCode();
		const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

		// Request to install dependency.
		if (process.env.USE_WASI_SERVER === "true") {
			args.push('--install-extension');
			args.push('ms-vscode.wasm-wasi-core');
		}

		cp.spawnSync(
			cliPath,
			args,
			{
				encoding: 'utf-8',
				stdio: 'inherit'
			}
		);

		// Download VS Code, unzip it and run the integration test
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [
				path.resolve(__dirname, '../../test/')
			]
		});
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

async function web(extensionDevelopmentPath: string) {
	try {
		// The webworker extension host can only resolve the `vscode` module, so the suite
		// is loaded from its webpack bundle instead of the raw tsc output used by node.
		const extensionTestsPath = path.resolve(extensionDevelopmentPath, './dist/web-test/suite/index');

		// Run integration test in a web version of vscode.
		await runTestsWeb({
			browserType: 'chromium',
			extensionDevelopmentPath,
			extensionTestsPath,
			folderPath: path.resolve(__dirname, '../../test/'),
			extensionIds: [{ id: "ms-vscode.wasm-wasi-core" }],
			// The wasi runtime relies on SharedArrayBuffer, which requires the page
			// to be cross origin isolated (COOP: same-origin & COEP: require-corp).
			coi: true
		});
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

async function main() {
	// The folder containing the Extension Manifest package.json
	// Passed to `--extensionDevelopmentPath`
	const extensionDevelopmentPath = path.resolve(__dirname, '../../');

	// The path to test runner
	// Passed to --extensionTestsPath
	const extensionTestsPath = path.resolve(__dirname, './suite/index');
	
	if (process.env.TEST_IN_BROWSER === "true") {
		return web(extensionDevelopmentPath);
	} else {
		return native(extensionDevelopmentPath, extensionTestsPath);
	}
}

main();
