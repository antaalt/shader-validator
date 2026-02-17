import * as path from 'path';

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import * as cp from 'child_process';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');
		
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
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
