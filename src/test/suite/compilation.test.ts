import * as assert from 'assert';

import * as vscode from 'vscode';
import { activate, isUsingWasiServer, openAndShowFile } from './utils';
import { CompilationType, CompileShaderResult } from '../../request';
import { ShaderStage } from '../../view/variant/variant';

suite('Compilation Test Suite', () => {
    vscode.window.showInformationMessage('Start all compilation tests.');
    suiteTeardown(async () => {
        // Remove variant for next test.
        await vscode.commands.executeCommand(
            'shader-validator.disableActiveShaderVariant'
        );
        vscode.window.showInformationMessage('All compilation tests done!');
    });
    test('Check GLSL compilation', async () => {
        const docUri = await vscode.workspace.findFiles("test.frag.glsl");
        assert.ok(docUri.length > 0);
        await activate()!;
        await openAndShowFile(docUri[0]);
        // Register variant in order to allow compilation.
        await vscode.commands.executeCommand(
            'shader-validator.addShaderVariant',
            docUri[0],
            "main",
            ShaderStage.fragment
        );
        // Request compilation
        const compilationResult = (await vscode.commands.executeCommand(
            'shader-validator.compileShader',
            docUri[0]
        )) as CompileShaderResult | null;
        assert.ok(compilationResult);
        assert.equal(compilationResult.compilationType, CompilationType.Spirv);
        assert.equal(compilationResult.data.length, 608);
        // TODO: Could somehow validate that this is a valid SPIRV. 
        // Check with glslang if its available ?
    }).timeout(10000); // First test to run on non WASI target
});