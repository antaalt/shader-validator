import * as assert from 'assert';

import * as vscode from 'vscode';
import { activate, isUsingWasiServer, openAndShowFile } from './utils';
import { CompilationType, CompileShaderResult, decodeCompileShaderData } from '../../request';
import { ShaderStage } from '../../view/variant/variant';

// Accept both endianness, as server test does.
function isValidMagicNumber(data: Uint8Array, magicNumber: number): boolean {
    if (data.length < 4) {
        return false;
    }
    const view = new DataView(data.buffer, data.byteOffset, 4);
    return view.getUint32(0, true) === magicNumber || view.getUint32(0, false) === magicNumber;
}
function isValidDxil(dxil: Uint8Array): boolean {
    const DXIL_MAGIC_NUMBER = 0x43425844; // 'DXBC'
    return isValidMagicNumber(dxil, DXIL_MAGIC_NUMBER);
}

function isValidSpirv(spirv: Uint8Array) : boolean {
    const SPIRV_MAGIC_NUMBER = 0x07230203;
    return isValidMagicNumber(spirv, SPIRV_MAGIC_NUMBER);
}

suite('Compilation Test Suite', () => {
    const useWasiServer = isUsingWasiServer();
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
        assert.equal(disassembleResult.data.length, 786);
        assert.ok(disassembleResult.data.startsWith('; SPIR-V'));
    }).timeout(10000); // First test to run on non WASI target

    
    test('Check HLSL compilation', async () => {
        // No DXC on wasi. Skip test.
        if (useWasiServer) return;
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
        assert.equal(compilationResult.data.length, 2428);
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
        assert.equal(disassembleResult.data.length, 658);
        // Seems different on each platform
        //assert.ok(disassembleResult.data.startsWith(';\n; Input signature:'));
    }).timeout(10000); // First test to run on non WASI target
});