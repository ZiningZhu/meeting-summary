import { Notice, TFile } from 'obsidian';
import type MeetingSummaryPlugin from '../main';
import { summariseTranscript } from '../llm/summarise';
import {
	SUMMARY_HEADING,
	TRANSCRIPT_HEADING,
	extractSection,
	upsertSection,
} from '../notes/sections';
import { localIsoString } from '../utils/format';

/** Everything after the frontmatter, used when there is no Transcript section. */
function stripFrontmatter(content: string): string {
	const lines = content.split('\n');
	if (lines[0]?.trim() !== '---') return content;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') return lines.slice(i + 1).join('\n');
	}
	return content;
}

/**
 * Reads a note's transcript, summarises it, and writes the result into a
 * `## Summary` section above the transcript — replacing any existing one.
 */
export async function summarizeFile(
	plugin: MeetingSummaryPlugin,
	file: TFile,
): Promise<void> {
	const content = await plugin.app.vault.read(file);
	const section = extractSection(content, TRANSCRIPT_HEADING);

	// Fall back to the whole body so the command also works on notes that were
	// not created by this plugin.
	const transcript = section ?? stripFrontmatter(content).trim();
	if (transcript.length === 0) {
		throw new Error(`"${file.basename}" has no transcript to summarise.`);
	}

	const summary = await summariseTranscript(plugin.settings, transcript, {
		title: file.basename,
		date: localIsoString(new Date(file.stat.ctime)).slice(0, 10),
	});

	await plugin.app.vault.process(file, (current) =>
		upsertSection(current, SUMMARY_HEADING, summary, TRANSCRIPT_HEADING),
	);
}

/** Command entry point: summarises the active note with user-facing feedback. */
export async function summarizeActiveFile(
	plugin: MeetingSummaryPlugin,
	file: TFile,
): Promise<void> {
	const progress = new Notice('Summarising meeting…', 0);
	try {
		await summarizeFile(plugin, file);
		progress.hide();
		new Notice('Summary written.');
	} catch (error) {
		progress.hide();
		const message = error instanceof Error ? error.message : String(error);
		new Notice(message, 10000);
		console.error('Meeting summary: summarisation failed', error);
	}
}
