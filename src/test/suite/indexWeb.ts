// Web entry point for the test suite, bundled for the webworker extension host.
// The browser extension host only resolves the `vscode` module, so everything else
// (mocha included) has to be webpack'ed into this file. See webpack.config.js.

// Imports mocha for the browser, defining the `mocha` global.
require('mocha/mocha');

export function run(): Promise<void> {
	return new Promise((c, e) => {
		// /!\ Must run before requiring the tests, as it defines the tdd globals they use. /!\
		mocha.setup({
			ui: 'tdd',
			reporter: undefined, // No DOM in a webworker, fallback on the spec reporter.
		});

		// There is no filesystem in the browser, so tests cannot be discovered with glob.
		// Requires are lazy on purpose, see mocha.setup above.
		// binary & version tests are node only (fs, child_process), they are skipped here.
		require('./compilation.test');
		require('./completion.test');
		require('./diagnostic.test');
		require('./setting.test');
		require('./variant.test');

		try {
			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
