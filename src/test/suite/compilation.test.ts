import * as assert from 'assert';

import * as vscode from 'vscode';
import { activate, openAndShowFile } from './utils';
import { ServerPlatform, ServerVersion } from '../../client';
import { CompileShaderResult } from '../../request';

suite('Compilation Test Suite', () => {
    vscode.window.showInformationMessage('Start all compilation tests.');
    suiteTeardown(() => {
        vscode.window.showInformationMessage('All compilation tests done!');
    });
    // Wasm target should always be here.
    const useWasiServer = process.env.USE_WASI_SERVER === "true";
    const platform = ServerVersion.getServerPlatform();
    if (platform === ServerPlatform.windows && !useWasiServer) {
        test('Check GLSL compilation', async () => {
            const docUri = await vscode.workspace.findFiles("test.frag.glsl");
            assert.ok(docUri.length > 0);
            await activate(true)!;
            await openAndShowFile(docUri[0]);
            const compilationResult = (await vscode.commands.executeCommand(
                'shader-validator.compileShader',
                docUri
            )) as CompileShaderResult | null;
            assert.ok(compilationResult);
            assert.notEqual(compilationResult.ty, 'None');
            assert.equal(compilationResult.data.length, 608);
            // TODO: Could somehow validate that this is a valid SPIRV. 
            // Check with glslang if its available ?
        }).timeout(5000);

    }
});