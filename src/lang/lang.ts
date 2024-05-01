import * as vscode from "vscode";

export class ValidationResult {

}
export class ParseResult {

}

export interface ShaderValidator {
    validate(document: vscode.TextDocument): ValidationResult;
}

export interface ShaderParseTree {
    parse(document: vscode.TextDocument): ParseResult;
}