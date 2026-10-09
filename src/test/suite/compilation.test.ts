import * as assert from 'assert';

import * as vscode from 'vscode';
import { activate, isUsingWasiServer, openAndShowFile } from './utils';
import { CompilationType, CompileShaderResult, decodeCompileShaderData } from '../../request';
import { ShaderStage } from '../../view/variant/variant';

function isValidMagicNumber(data: Uint8Array, magicNumber: Uint8Array): boolean {
    for (let i = 0; i < 4; i++) {
        if (magicNumber[i] !== data[i]) {
            return false;
        }
    }
    return true;
}
function isValidDxil(dxil: Uint8Array): boolean {
    const DXIL_MAGIC_LE = new Uint8Array([0x43, 0x42, 0x58, 0x44]);
    return isValidMagicNumber(dxil, DXIL_MAGIC_LE)
}

function isValidSpirv(spirv: Uint8Array) : boolean {
    const SPIRV_MAGIC_LE = new Uint8Array([0x07, 0x23, 0x02, 0x03]);
    return isValidMagicNumber(spirv, SPIRV_MAGIC_LE)
}

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
            docUri[0],
            CompilationType.Spirv,
            false,
        )) as CompileShaderResult | null;
        assert.ok(compilationResult);
        assert.equal(compilationResult.compilationType, CompilationType.Spirv);
        assert.equal(compilationResult.data.length, 608);
        let spirv = decodeCompileShaderData(compilationResult.data, compilationResult.compilationType, false);
        assert.ok(isValidSpirv(spirv));
        // Request disassembly
        const disassembleResult = (await vscode.commands.executeCommand(
            'shader-validator.compileShader',
            docUri[0],
            CompilationType.Spirv,
            true,
        )) as CompileShaderResult | null;
        assert.ok(disassembleResult);
        assert.equal(disassembleResult.compilationType, CompilationType.Spirv);
        assert.equal(disassembleResult.data.length, 608);
        assert.ok(disassembleResult.data.startsWith('; SPIR-V'));
    }).timeout(10000); // First test to run on non WASI target

    
    test('Check HLSL compilation', async () => {
        const docUri = await vscode.workspace.findFiles("test.hlsl");
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
            docUri[0],
            CompilationType.Dxil,
            false,
        )) as CompileShaderResult | null;
        assert.ok(compilationResult);
        assert.equal(compilationResult.compilationType, CompilationType.Dxil);
        assert.equal(compilationResult.data.length, 608);
        let spirv = decodeCompileShaderData(compilationResult.data, compilationResult.compilationType, false);
        assert.ok(isValidDxil(spirv));
        // Request disassembly
        const disassembleResult = (await vscode.commands.executeCommand(
            'shader-validator.compileShader',
            docUri[0],
            CompilationType.Dxil,
            true,
        )) as CompileShaderResult | null;
        assert.ok(disassembleResult);
        assert.equal(disassembleResult.compilationType, CompilationType.Dxil);
        assert.equal(disassembleResult.data.length, 608);
        assert.ok(disassembleResult.data.startsWith(';\n; Input signature:'));
    }).timeout(10000); // First test to run on non WASI target
});