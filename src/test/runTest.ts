import * as path from 'path';
import * as fs from 'fs';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({ 
			extensionDevelopmentPath, 
			extensionTestsPath, 
			launchArgs: [ 
				//"--disable-extensions",
				path.resolve(__dirname, '../../test/')
			] 
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
