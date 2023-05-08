import * as vscode from 'vscode';
import { BaseLanguageClient, TextDocument } from 'vscode-languageclient';
import { GetVirtualFileNamesRequest, GetVirtualFileRequest } from '@volar/language-server';
import { SourceMap, Stack } from '@volar/source-map';
import type { FileRangeCapabilities } from '@volar/language-core';

const scheme = 'volar-virtual-file';
const mappingDecorationType = vscode.window.createTextEditorDecorationType({
	borderWidth: '1px',
	borderStyle: 'solid',
	overviewRulerColor: 'blue',
	overviewRulerLane: vscode.OverviewRulerLane.Right,
	light: {
		// this color will be used in light color themes
		borderColor: 'darkblue'
	},
	dark: {
		// this color will be used in dark color themes
		borderColor: 'lightblue'
	}
});
const mappingSelectionDecorationType = vscode.window.createTextEditorDecorationType({
	cursor: 'crosshair',
	light: {
		backgroundColor: 'lightblue'
	},
	dark: {
		backgroundColor: 'darkblue'
	}
});

export async function activate(cmd: string, client: BaseLanguageClient) {

	const subscriptions: vscode.Disposable[] = [];

	subscriptions.push(vscode.languages.registerHoverProvider({ scheme }, {
		async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {

			const maps = virtualUriToSourceMap.get(document.uri.toString());
			if (!maps) return;

			const data: {
				uri: string,
				mapping: any,
			}[] = [];

			for (const [sourceUri, _, map] of maps) {
				const source = map.toSourceOffset(document.offsetAt(position));
				if (source) {
					data.push({
						uri: sourceUri,
						mapping: source,
					});
				}
			}

			if (data.length === 0) return;

			return new vscode.Hover(data.map((data) => [
				data.uri,
				'',
				'',
				'```json',
				JSON.stringify(data.mapping, null, 2),
				'```',
			].join('\n')));
		}
	}));

	subscriptions.push(vscode.languages.registerDefinitionProvider({ scheme }, {
		async provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {

			const stacks = virtualUriToStacks.get(document.uri.toString());
			if (!stacks) return;

			const offset = document.offsetAt(position);
			const stack = stacks.find(stack => stack.range[0] <= offset && offset <= stack.range[1]);
			if (!stack) return;

			const line = Number(stack.source.split(':').at(-2));
			const character = Number(stack.source.split(':').at(-1));
			const fileName = stack.source.split(':').slice(0, -2).join(':');
			const link: vscode.DefinitionLink = {
				originSelectionRange: new vscode.Range(document.positionAt(stack.range[0]), document.positionAt(stack.range[1])),
				targetUri: vscode.Uri.file(fileName),
				targetRange: new vscode.Range(line - 1, character - 1, line - 1, character - 1),
			};
			return [link];
		}
	}));

	const sourceUriToVirtualUris = new Map<string, Set<string>>();
	const virtualUriToSourceEditor = new Map<string, vscode.TextEditor>();
	const virtualUriToSourceMap = new Map<string, [string, number, SourceMap<FileRangeCapabilities>][]>();
	const virtualUriToStacks = new Map<string, Stack[]>();
	const docChangeEvent = new vscode.EventEmitter<vscode.Uri>();
	const virtualDocuments = new Map<string, TextDocument>();

	let updateVirtualDocument: NodeJS.Timeout | undefined;
	let updateDecorationsTimeout: NodeJS.Timeout | undefined;

	subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateDecorations));
	subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateDecorations));
	subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(updateDecorations));
	subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		if (sourceUriToVirtualUris.has(e.document.uri.toString())) {
			const virtualUris = sourceUriToVirtualUris.get(e.document.uri.toString());
			clearTimeout(updateVirtualDocument);
			updateVirtualDocument = setTimeout(() => {
				virtualUris?.forEach(uri => {
					docChangeEvent.fire(vscode.Uri.parse(uri));
				});
			}, 100);
		}
	}));
	subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
		scheme,
		{
			onDidChange: docChangeEvent.event,
			async provideTextDocumentContent(uri: vscode.Uri): Promise<string | undefined> {

				const fileName = uri.with({ scheme: 'file' }).fsPath;
				const requestEditor = virtualUriToSourceEditor.get(uri.toString());

				if (requestEditor) {

					const virtualFile = await client.sendRequest(GetVirtualFileRequest.type, { sourceFileUri: requestEditor.document.uri.toString(), virtualFileName: fileName });
					virtualUriToSourceMap.set(uri.toString(), []);

					Object.entries(virtualFile.mappings).forEach(([sourceUri, mappings]) => {
						const sourceEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === sourceUri);
						if (sourceEditor) {
							virtualUriToSourceMap.get(uri.toString())?.push([
								sourceEditor.document.uri.toString(),
								sourceEditor.document.version,
								new SourceMap(mappings),
							]);
							if (!sourceUriToVirtualUris.has(sourceUri)) {
								sourceUriToVirtualUris.set(sourceUri, new Set());
							}
							sourceUriToVirtualUris.get(sourceUri)?.add(uri.toString());
						}
					});
					virtualDocuments.set(uri.toString(), TextDocument.create('', '', 0, virtualFile.content));
					virtualUriToStacks.set(uri.toString(), virtualFile.codegenStacks);

					clearTimeout(updateDecorationsTimeout);
					updateDecorationsTimeout = setTimeout(updateDecorations, 100);

					return virtualFile.content;
				}
			}
		},
	));
	subscriptions.push(vscode.commands.registerCommand(cmd, async () => {
		const sourceEditor = vscode.window.activeTextEditor;
		if (sourceEditor) {
			const fileNames = await client.sendRequest(GetVirtualFileNamesRequest.type, client.code2ProtocolConverter.asTextDocumentIdentifier(sourceEditor.document));
			const uris = fileNames.map(fileName => vscode.Uri.file(fileName).with({ scheme }));
			sourceUriToVirtualUris.set(sourceEditor.document.uri.toString(), new Set(uris.map(uri => uri.toString())));
			for (const uri of uris) {
				virtualUriToSourceEditor.set(uri.toString(), sourceEditor);
				vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Two, preview: false });
			}
		}
	}));

	return vscode.Disposable.from(...subscriptions);

	function updateDecorations() {
		for (const [virtualUri, sources] of virtualUriToSourceMap) {

			const virtualEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === virtualUri);
			let virtualRanges1: vscode.Range[] = [];
			let virtualRanges2: vscode.Range[] = [];

			if (virtualEditor) {
				for (const [sourceUri, sourceVersion, map] of sources) {
					const sourceEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === sourceUri);
					if (sourceEditor && sourceEditor.document.version === sourceVersion) {
						const mappingDecorationRanges = map.mappings.map(mapping => new vscode.Range(
							sourceEditor.document.positionAt(mapping.sourceRange[0]),
							sourceEditor.document.positionAt(mapping.sourceRange[1]),
						));
						sourceEditor.setDecorations(mappingDecorationType, mappingDecorationRanges);
						virtualRanges1 = virtualRanges1.concat(map.mappings.map(mapping => new vscode.Range(
							getGeneratedPosition(virtualUri, mapping.generatedRange[0]),
							getGeneratedPosition(virtualUri, mapping.generatedRange[1]),
						)));

						/**
						 * selection
						 */
						if (vscode.window.activeTextEditor) {
							const selection = vscode.window.activeTextEditor.selection;
							const startOffset = vscode.window.activeTextEditor.document.offsetAt(selection.start);
							sourceEditor.setDecorations(mappingSelectionDecorationType, []);
							if (vscode.window.activeTextEditor === sourceEditor) {
								const matchVirtualRanges = [...map.toGeneratedOffsets(startOffset)];
								sourceEditor.setDecorations(mappingSelectionDecorationType, matchVirtualRanges.map(mapped => new vscode.Range(
									sourceEditor.document.positionAt(mapped[1].sourceRange[0]),
									sourceEditor.document.positionAt(mapped[1].sourceRange[1]),
								)));
								virtualRanges2 = virtualRanges2.concat(matchVirtualRanges.map(mapped => new vscode.Range(
									getGeneratedPosition(virtualUri, mapped[1].generatedRange[0]),
									getGeneratedPosition(virtualUri, mapped[1].generatedRange[1]),
								)));
								const mapped = matchVirtualRanges.sort((a, b) => a[1].generatedRange[0] - b[1].generatedRange[0])[0];
								if (mapped) {
									virtualEditor.revealRange(new vscode.Range(
										getGeneratedPosition(virtualUri, mapped[1].generatedRange[0]),
										getGeneratedPosition(virtualUri, mapped[1].generatedRange[1]),
									));
								}
							}
							else if (vscode.window.activeTextEditor === virtualEditor) {
								const matchSourceRanges = [...map.toSourceOffsets(startOffset)];
								sourceEditor.setDecorations(mappingSelectionDecorationType, matchSourceRanges.map(mapped => new vscode.Range(
									sourceEditor.document.positionAt(mapped[1].sourceRange[0]),
									sourceEditor.document.positionAt(mapped[1].sourceRange[1]),
								)));
								virtualRanges2 = virtualRanges2.concat(matchSourceRanges.map(mapped => new vscode.Range(
									getGeneratedPosition(virtualUri, mapped[1].generatedRange[0]),
									getGeneratedPosition(virtualUri, mapped[1].generatedRange[1]),
								)));
								const mapped = matchSourceRanges.sort((a, b) => a[1].sourceRange[0] - b[1].sourceRange[0])[0];
								if (mapped) {
									sourceEditor.revealRange(new vscode.Range(
										sourceEditor.document.positionAt(mapped[1].sourceRange[0]),
										sourceEditor.document.positionAt(mapped[1].sourceRange[1]),
									));
								}
							}
						}
						else {
							sourceEditor.setDecorations(mappingSelectionDecorationType, []);
						}
					}
				}
				virtualEditor.setDecorations(mappingDecorationType, virtualRanges1);
				virtualEditor.setDecorations(mappingSelectionDecorationType, virtualRanges2);
			}
			else {
				for (const [sourceUri] of sources) {
					const sourceEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === sourceUri);
					if (sourceEditor) {
						sourceEditor.setDecorations(mappingDecorationType, []);
						sourceEditor.setDecorations(mappingSelectionDecorationType, []);
					}
				}
			}
		}
	}

	function getGeneratedPosition(virtualUri: string, offset: number) {
		const document = virtualDocuments.get(virtualUri)!;
		const position = document.positionAt(offset);
		return new vscode.Position(position.line, position.character);
	}
}
