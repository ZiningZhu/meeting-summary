import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { TRANSCRIPT_HEADING } from './sections';
import { MeetingSummarySettings } from '../settings';
import { TranscriptionResult } from '../types';
import {
	formatDuration,
	formatTimestamp,
	localIsoString,
	sanitizeFileName,
	segmentsToMarkdown,
	timestampForFilename,
} from '../utils/format';

/** Creates `folderPath` and any missing parents. No-op when it exists. */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const path = normalizePath(folderPath);
	if (path === '' || path === '/' || path === '.') return;

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) {
		throw new Error(`"${path}" already exists and is not a folder.`);
	}
	await app.vault.createFolder(path);
}

/** Appends ` 2`, ` 3`, … until the path is free. */
function uniquePath(app: App, folder: string, base: string, extension: string): string {
	const prefix = folder ? `${normalizePath(folder)}/` : '';
	let candidate = normalizePath(`${prefix}${base}.${extension}`);
	let counter = 2;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${prefix}${base} ${counter}.${extension}`);
		counter++;
	}
	return candidate;
}

/** Writes the recorded audio into the vault and returns the created file. */
export async function saveRecording(
	app: App,
	settings: MeetingSummarySettings,
	audio: ArrayBuffer,
	extension: string,
	date: Date,
): Promise<TFile> {
	await ensureFolder(app, settings.audioFolder);
	const path = uniquePath(
		app,
		settings.audioFolder,
		`Meeting ${timestampForFilename(date)}`,
		extension,
	);
	return app.vault.createBinary(path, audio);
}

function buildFrontmatter(
	result: TranscriptionResult,
	date: Date,
	durationSeconds: number,
): string {
	const speakers = [...new Set(result.segments.map((s) => s.speaker))];
	const lines = [
		'---',
		'type: meeting',
		`created: ${localIsoString(date)}`,
		`duration: ${formatDuration(durationSeconds)}`,
		`transcription: ${result.provider} (${result.model})`,
		`diarised: ${result.diarised}`,
	];
	if (result.language) lines.push(`language: ${result.language}`);
	lines.push('speakers:');
	for (const speaker of speakers) lines.push(`  - ${speaker}`);
	lines.push('---');
	return lines.join('\n');
}

/**
 * A callout naming the stretches that failed to transcribe, so a gap in the
 * transcript is never mistaken for silence in the meeting.
 */
function buildGapCallout(result: TranscriptionResult): string[] {
	const gaps = result.gaps ?? [];
	if (gaps.length === 0) return [];

	const lines = ['> [!warning] Transcription incomplete'];
	for (const gap of gaps) {
		lines.push(
			`> - No transcript for ${formatTimestamp(gap.start)}–${formatTimestamp(gap.end)}: ${gap.reason}`,
		);
	}
	lines.push('');
	return lines;
}

export interface MeetingNoteInput {
	result: TranscriptionResult;
	date: Date;
	durationSeconds: number;
	/** Vault path of the saved recording, when one was kept. */
	audioPath?: string;
	title?: string;
}

/** Creates the timestamped meeting note and returns the new file. */
export async function createMeetingNote(
	app: App,
	settings: MeetingSummarySettings,
	input: MeetingNoteInput,
): Promise<TFile> {
	const { result, date, durationSeconds, audioPath, title } = input;

	await ensureFolder(app, settings.noteFolder);
	const baseName = sanitizeFileName(
		title ?? `Meeting ${timestampForFilename(date)}`,
	);
	const path = uniquePath(app, settings.noteFolder, baseName, 'md');

	const lines = [buildFrontmatter(result, date, durationSeconds), ''];
	if (audioPath) lines.push(`**Recording:** ![[${audioPath}]]`, '');
	lines.push(...buildGapCallout(result));
	lines.push(
		`## ${TRANSCRIPT_HEADING}`,
		'',
		segmentsToMarkdown(result.segments, settings.includeTimestamps),
		'',
	);

	return app.vault.create(path, lines.join('\n'));
}
