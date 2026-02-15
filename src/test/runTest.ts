import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		const args = process.argv.slice(2); // Skip the first two elements (node path and script path)
		const isTestingWasiServer = args.find((value, _index, _obj) => {
			return value === "--useWasiServer";
		}) != undefined;
		if (isTestingWasiServer) {
			console.info("Executing test with wasi server");
		} else {
			console.info("Executing test with native server");
		}

		// Download VS Code, unzip it and run the integration test
		await runTests({ 
			extensionDevelopmentPath, 
			extensionTestsPath, 
			launchArgs: [ 
				//"--disable-extensions",
				path.resolve(__dirname, '../../test/')
			],
			extensionTestsEnv: {
				"USE_WASI_SERVER": isTestingWasiServer ? "true" : "false",
			}
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
