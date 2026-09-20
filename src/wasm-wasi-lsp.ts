/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';

import { Readable, WasmProcess, Writable, type Stdio } from '@vscode/wasm-wasi/v1';
import { Disposable, Emitter, Event, Message, MessageTransports, RAL, ReadableStreamMessageReader, WriteableStreamMessageWriter } from 'vscode-languageclient';

class ReadableStreamImpl implements RAL.ReadableStream {

	private readonly errorEmitter: Emitter<[Error, Message | undefined, number | undefined]>;
	private readonly closeEmitter: Emitter<void>;
	private readonly endEmitter: Emitter<void>;

	private readonly readable: Readable;

	constructor(readable: Readable) {
		this.errorEmitter = new Emitter<[Error, Message, number]>();
		this.closeEmitter = new Emitter<void>();
		this.endEmitter = new Emitter<void>();
		this.readable = readable;
	}

	public get onData(): Event<Uint8Array> {
		return this.readable.onData;
	}

	public get onError(): Event<[Error, Message | undefined, number | undefined]> {
		return this.errorEmitter.event;
	}

	public fireError(error: any, message?: Message, count?: number): void {
		this.errorEmitter.fire([error, message, count]);
	}

	public get onClose(): Event<void> {
		return this.closeEmitter.event;
	}

	public fireClose(): void {
		this.closeEmitter.fire(undefined);
	}

	public onEnd(listener: () => void): Disposable {
		return this.endEmitter.event(listener);
	}

	public fireEnd(): void {
		this.endEmitter.fire(undefined);
	}
}

type MessageBufferEncoding = RAL.MessageBufferEncoding;

class WritableStreamImpl implements RAL.WritableStream {

	private readonly errorEmitter: Emitter<[Error, Message | undefined, number | undefined]>;
	private readonly closeEmitter: Emitter<void>;
	private readonly endEmitter: Emitter<void>;

	private readonly writable: Writable;

	constructor(writable: Writable) {
		this.errorEmitter = new Emitter<[Error, Message, number]>();
		this.closeEmitter = new Emitter<void>();
		this.endEmitter = new Emitter<void>();
		this.writable = writable;
	}

	public get onError(): Event<[Error, Message | undefined, number | undefined]> {
		return this.errorEmitter.event;
	}

	public fireError(error: any, message?: Message, count?: number): void {
		this.errorEmitter.fire([error, message, count]);
	}

	public get onClose(): Event<void> {
		return this.closeEmitter.event;
	}

	public fireClose(): void {
		this.closeEmitter.fire(undefined);
	}

	public onEnd(listener: () => void): Disposable {
		return this.endEmitter.event(listener);
	}

	public fireEnd(): void {
		this.endEmitter.fire(undefined);
	}

	public write(data: string | Uint8Array, _encoding?: MessageBufferEncoding): Promise<void> {
		if (typeof data === 'string') {
			return this.writable.write(data, 'utf-8');
		} else {
			return this.writable.write(data);
		}
	}

	public end(): void {
	}
}

export function createStdioOptions(): Stdio {
	return {
		in: {
			kind: 'pipeIn',
		},
		out: {
			kind: 'pipeOut'
		},
		err: {
			kind: 'pipeOut'
		}
	};
}

export async function startServer(process: WasmProcess, readable: Readable | undefined = process.stdout, writable: Writable | undefined = process.stdin): Promise<MessageTransports> {

	if (readable === undefined || writable === undefined) {
		throw new Error('Process created without streams or no streams provided.');
	}

	const reader = new ReadableStreamImpl(readable);
	const writer = new WritableStreamImpl(writable);

	process.run().then((value) => {
		if (value === 0) {
			reader.fireEnd();
		} else {
			reader.fireError([new Error(`Process exited with code: ${value}`), undefined, undefined]);
		}
	}, (error) => {
		reader.fireError([error, undefined, undefined]);
	});

	return { reader: new ReadableStreamMessageReader(reader), writer: new WriteableStreamMessageWriter(writer), detached: false };
}

export function createUriConverters(): { code2Protocol: (value: vscode.Uri) => string; protocol2Code: (value: string) => vscode.Uri } | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (folders === undefined || folders.length === 0) {
		return undefined;
	}
	// Both sides of a mapping must be built the same way, without a trailing slash, so that the
	// separator always comes from the remainder of the uri. With a trailing slash on one side only,
	// the substitution duplicates it on the way out and drops it on the way back. That stays
	// invisible for uris the server echoes back, as the two cancel out, but it corrupts the ones
	// the server builds itself, such as the `textDocument/dependencyTree` result.
	const asPrefix = (uri: string) => uri.endsWith('/') ? uri.slice(0, -1) : uri;
	const c2p: Map<string, string> = new Map();
	const p2c: Map<string, string> = new Map();
	if (folders.length === 1) {
		const uri = asPrefix(folders[0].uri.toString());
		c2p.set(uri, 'file:///workspace');
		p2c.set('file:///workspace', uri);
	} else {
		for (const folder of folders) {
			const uri = asPrefix(folder.uri.toString());
			c2p.set(uri, `file:///workspace/${folder.name}`);
			p2c.set(`file:///workspace/${folder.name}`, uri);
		}
	}
	// Match on path boundaries only, else a folder named `shader` also captures `shader-sense`.
	const substitute = (value: string, mapping: Map<string, string>) => {
		for (const [prefix, replacement] of mapping) {
			if (value === prefix || value.startsWith(`${prefix}/`)) {
				return `${replacement}${value.slice(prefix.length)}`;
			}
		}
		return value;
	};
	return {
		code2Protocol: (uri: vscode.Uri) => substitute(uri.toString(), c2p),
		protocol2Code: (value: string) => vscode.Uri.parse(substitute(value, p2c))
	};
}