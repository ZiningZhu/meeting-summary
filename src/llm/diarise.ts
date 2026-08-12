import { MeetingSummarySettings } from '../settings';
import { TranscriptSegment } from '../types';
import { formatTimestamp } from '../utils/format';
import { callClaude } from './anthropic';

/**
 * Fallback speaker attribution for transcription providers that return no
 * speaker labels. This infers turns from wording and timing, so it is weaker
 * than acoustic diarisation — treat the labels as a best guess.
 */

const CHUNK_SIZE = 250;
/** Labelled lines carried into the next chunk to keep numbering consistent. */
const CONTEXT_LINES = 6;

const SYSTEM_PROMPT = `You assign speaker labels to lines of a meeting transcript that arrived without them.

Infer turn boundaries from conversational cues: questions and answers, self-introductions, named address, topic handoffs, and gaps between timestamps. Consecutive lines usually belong to the same speaker — only start a new speaker when the transcript gives you a reason to.

Label speakers "Speaker 1", "Speaker 2", and so on, numbered by first appearance. If a real name is clearly established in the transcript (someone introduces themselves, or is addressed by name and then answers), use that name instead, spelled consistently. Return exactly one assignment for every line index you are given.`;

const SCHEMA = {
	type: 'object',
	properties: {
		assignments: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					index: { type: 'integer' },
					speaker: { type: 'string' },
				},
				required: ['index', 'speaker'],
				additionalProperties: false,
			},
		},
	},
	required: ['assignments'],
	additionalProperties: false,
};

interface Assignment {
	index: number;
	speaker: string;
}

function parseAssignments(raw: string): Assignment[] {
	const parsed = JSON.parse(raw) as { assignments?: unknown };
	if (!Array.isArray(parsed.assignments)) {
		throw new Error('Speaker attribution response was missing assignments.');
	}
	return parsed.assignments.filter(
		(item): item is Assignment =>
			typeof item === 'object' &&
			item !== null &&
			typeof (item as Assignment).index === 'number' &&
			typeof (item as Assignment).speaker === 'string',
	);
}

/** Returns a copy of `segments` with inferred speaker labels applied. */
export async function diariseWithClaude(
	settings: MeetingSummarySettings,
	segments: TranscriptSegment[],
	onProgress?: (message: string) => void,
): Promise<TranscriptSegment[]> {
	if (segments.length === 0) return segments;

	const labelled: TranscriptSegment[] = [];
	const chunkCount = Math.ceil(segments.length / CHUNK_SIZE);

	for (let chunk = 0; chunk < chunkCount; chunk++) {
		const offset = chunk * CHUNK_SIZE;
		const slice = segments.slice(offset, offset + CHUNK_SIZE);

		if (chunkCount > 1) {
			onProgress?.(`Attributing speakers (part ${chunk + 1} of ${chunkCount})…`);
		}

		// Indexes in `labelled` are global, since every prior segment is present.
		const contextStart = Math.max(0, labelled.length - CONTEXT_LINES);
		const context = labelled
			.slice(contextStart)
			.map(
				(segment, i) =>
					`${contextStart + i}\t[${formatTimestamp(segment.start)}]\t${segment.speaker}: ${segment.text}`,
			)
			.join('\n');

		const lines = slice
			.map(
				(segment, i) =>
					`${offset + i}\t[${formatTimestamp(segment.start)}]\t${segment.text}`,
			)
			.join('\n');

		const user =
			(context
				? `Already-labelled lines immediately before this batch, for continuity:\n${context}\n\n`
				: '') +
			`Assign a speaker to each of the following lines. Each line is "index<TAB>[timestamp]<TAB>text".\n\n${lines}`;

		const raw = await callClaude(settings, {
			system: SYSTEM_PROMPT,
			user,
			jsonSchema: SCHEMA,
			maxTokens: 16000,
		});

		const bySpeaker = new Map<number, string>();
		for (const assignment of parseAssignments(raw)) {
			bySpeaker.set(assignment.index, assignment.speaker);
		}

		slice.forEach((segment, i) => {
			const speaker = bySpeaker.get(offset + i);
			labelled.push({
				...segment,
				speaker: speaker?.trim() || segment.speaker,
			});
		});
	}

	return labelled;
}
