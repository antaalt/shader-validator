// Applying Rust naming convention on this file.
/* eslint-disable @typescript-eslint/naming-convention */

export interface RPCParserErr {
    filename: string;
    severity: string;
    error: string;
    line: number;
    pos: number;
}

export interface RPCValidationErr {
    message: string;
}

export type RPCUnknownError = string;

export interface RPCResponse<T> {
    jsonrpc: string;
    result: T;
    id: number;
}

export interface RPCValidationMessage {
    Ok?: true;
    ParserErr?: RPCParserErr;
    ValidationErr?: RPCValidationErr;
    UnknownError?: RPCUnknownError;
}

export interface RPCValidationResponse {
    IsOk: true;
    Messages?: RPCValidationMessage[];
}

export interface RPCGetFileTreeResponse {
    types: string[];
    global_variables: string[];
    functions: string[];
}

export interface RPCRequest {
    jsonrpc: "2.0";
    method: string;
    params: any;
    id: number;
}

export interface RPCValidateFileRequest extends RPCRequest {
    method: "validate_file";
    params: {
        path: string;
        cwd: string,
        shadingLanguage: string;
        includes: string[];
        defines: Object;
    };
}

export interface RPCGetFileTreeRequest extends RPCRequest {
    method: "get_file_tree";
    params: {
        path: string;
        cwd: string,
        shadingLanguage: string;
        includes: string[];
        defines: Object;
    };
}
