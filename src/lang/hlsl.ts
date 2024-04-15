import * as vscode from "vscode";

import { ShaderParseTree, ShaderValidator, ValidationResult, ParseResult } from "./lang";

export class Parameter {
    description?: string;
}

export interface Parameters { [name: string]: Parameter;}

export const functionRegex = /^\s*(public|export|global)\s+(constant|enum)\s+(\w+)\s+=\s+(.+)$/;

// TODO could have some parser on doc.
export let intrinsics: Parameters = {
    "smoothstep": {
        "description": "hello there",
    }
};

class HLSLLang implements ShaderValidator, ShaderParseTree {
    constructor() {
    }
    validate(document: vscode.TextDocument): ValidationResult {
        // Run a validation of document, return a promise ? Or blocking
        return {};
    }
    parse(document: vscode.TextDocument): ParseResult {
        // 
        return {};
    }
}