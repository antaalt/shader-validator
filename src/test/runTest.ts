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

		// Get path to first folder & create file for test.
		// GLSL
		const glslFileTestPath = path.resolve(extensionDevelopmentPath, "test", "test.frag.glsl");
		const glslFileContent = Buffer.from("#version 450\nuint test(uint nthNumber) {return 42;}\nvoid main() {uint res = test(0);}");
		await fs.writeFileSync(glslFileTestPath, glslFileContent);
		// HLSL
		const hlslFileTestPath = path.resolve(extensionDevelopmentPath, "test", "test.hlsl");
		const hlslFileContent = Buffer.from("uint test(uint nthNumber) {return 42;}\nvoid main() {uint res = test(0);}");
		await fs.writeFileSync(hlslFileTestPath, hlslFileContent);
		// WGSL
		const wgslFileTestPath = path.resolve(extensionDevelopmentPath, "test", "test.wgsl");
		const wgslFileContent = Buffer.from("fn test(nthNumber : u32) -> u32 {return 42u;}\nfn main() {var res = test(0u);}");
		await fs.writeFileSync(wgslFileTestPath, wgslFileContent);

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
