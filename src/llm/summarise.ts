import { MeetingSummarySettings } from '../settings';
import { callClaude } from './anthropic';

const SYSTEM_PROMPT = `You write meeting summaries from transcripts for people who were not in the room.

The transcript comes from automatic speech recognition, so expect misheard words, missing punctuation, and imperfect speaker labels. Read through those errors where the meaning is clear, and do not treat a garbled phrase as a substantive point.

Lead with what happened. Be specific: name the people, numbers, systems, and dates that were actually said, rather than paraphrasing them away. Write in plain prose and short bullets — no filler, no restating the instructions, no preamble before the first heading. Return Markdown only.`;

/** Summarises a transcript according to the user's configured instructions. */
export async function summariseTranscript(
	settings: MeetingSummarySettings,
	transcript: string,
	context?: { title?: string; date?: string },
): Promise<string> {
	const trimmed = transcript.trim();
	if (trimmed.length === 0) {
		throw new Error('There is no transcript text to summarise.');
	}

	const header = [
		context?.title ? `Meeting: ${context.title}` : null,
		context?.date ? `Date: ${context.date}` : null,
	]
		.filter((line): line is string => line !== null)
		.join('\n');

	const user = [
		settings.summaryPrompt,
		header ? `\n---\n\n${header}` : '\n---',
		`\nTranscript:\n\n${trimmed}`,
	].join('\n');

	return callClaude(settings, {
		system: SYSTEM_PROMPT,
		user,
		maxTokens: 16000,
	});
}
