// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([{ // IDesktopTestConfiguration
    platform: 'desktop',
    files: 'out/test/**/*.test.js',
    installExtensions: ['ms-vscode.wasm-wasi-core@prerelease']
}/*, { // IWebTestConfiguration
    platform: 'webworker', // web not supported yet.
    installExtensions: ['ms-vscode.wasm-wasi-core@prerelease']
}*/]);