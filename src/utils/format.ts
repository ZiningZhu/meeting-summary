import { TranscriptSegment } from '../types';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Zero-pads a number to at least two digits. */
function pad(value: number): string {
	return String(Math.floor(value)).padStart(2, '0');
}

/** Formats seconds as `MM:SS`, or `HH:MM:SS` past the hour mark. */
export function formatTimestamp(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(secs)}`
		: `${pad(minutes)}:${pad(secs)}`;
}

/** Human-readable duration for frontmatter, e.g. "1h 04m" or "12m 30s". */
export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (hours > 0) return `${hours}h ${pad(minutes)}m`;
	if (minutes > 0) return `${minutes}m ${pad(secs)}s`;
	return `${secs}s`;
}

/** `YYYY-MM-DD HH-MM-SS` — safe on every platform Obsidian runs on. */
export function timestampForFilename(date: Date): string {
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		` ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
	);
}

/** Local ISO-8601 timestamp (no UTC shift) for note frontmatter. */
export function localIsoString(date: Date): string {
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}

/** Strips characters Obsidian rejects in file names. */
export function sanitizeFileName(name: string): string {
	const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '').trim();
	return cleaned.length > 0 ? cleaned : 'Meeting';
}

/**
 * Renders segments as markdown, merging consecutive segments from the same
 * speaker so the transcript reads as paragraphs rather than caption lines.
 */
export function segmentsToMarkdown(
	segments: TranscriptSegment[],
	includeTimestamps: boolean,
): string {
	const merged: TranscriptSegment[] = [];
	for (const segment of segments) {
		const text = segment.text.trim();
		if (text.length === 0) continue;
		const previous = merged[merged.length - 1];
		if (previous && previous.speaker === segment.speaker) {
			previous.text = `${previous.text} ${text}`;
			previous.end = segment.end;
		} else {
			merged.push({ ...segment, text });
		}
	}

	return merged
		.map((segment) => {
			const stamp = includeTimestamps
				? ` (${formatTimestamp(segment.start)})`
				: '';
			return `**${segment.speaker}**${stamp}: ${segment.text}`;
		})
		.join('\n\n');
}

/** Renders segments as plain text for sending to the summarisation model. */
export function segmentsToPlainText(segments: TranscriptSegment[]): string {
	return segments
		.filter((segment) => segment.text.trim().length > 0)
		.map(
			(segment) =>
				`[${formatTimestamp(segment.start)}] ${segment.speaker}: ${segment.text.trim()}`,
		)
		.join('\n');
}

/**
 * Parses the `Speaker name mapping` setting: a comma-separated list where
 * position N names the provider's Nth speaker.
 */
export function parseSpeakerNames(raw: string): string[] {
	return raw
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}

/** Replaces generic speaker labels with configured names, where available. */
export function applySpeakerNames(
	segments: TranscriptSegment[],
	names: string[],
): TranscriptSegment[] {
	if (names.length === 0) return segments;
	const order: string[] = [];
	for (const segment of segments) {
		if (!order.includes(segment.speaker)) order.push(segment.speaker);
	}
	return segments.map((segment) => {
		const index = order.indexOf(segment.speaker);
		const name = index >= 0 ? names[index] : undefined;
		return name ? { ...segment, speaker: name } : segment;
	});
}
