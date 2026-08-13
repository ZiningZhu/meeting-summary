import { diariseWithClaude } from '../llm/diarise';
import { MeetingSummarySettings } from '../settings';
import { TranscriptGap, TranscriptSegment, TranscriptionResult } from '../types';
import { applySpeakerNames, parseSpeakerNames } from '../utils/format';
import { transcribeWithDeepInfra } from './deepinfra';
import { transcribeWithWhisper } from './whisper';

/** One piece of audio to transcribe, positioned within the whole recording. */
export interface AudioPart {
	data: ArrayBuffer;
	mimeType: string;
	fileName: string;
	/** Offset from the start of the recording, in seconds. */
	offsetSeconds: number;
	durationSeconds: number;
}

export interface TranscribeRequest {
	/** In chronological order. A single entry means an unsegmented recording. */
	parts: AudioPart[];
	onProgress?: (message: string) => void;
}

function runProvider(
	settings: MeetingSummarySettings,
	part: AudioPart,
): Promise<TranscriptionResult> {
	return settings.transcriptionProvider === 'deepinfra'
		? transcribeWithDeepInfra(settings, part.data, part.mimeType, part.fileName)
		: transcribeWithWhisper(settings, part.data, part.mimeType, part.fileName);
}

/**
 * Transcribes one part, retrying once. A long meeting is many requests, so a
 * single dropped connection should not cost the whole recording.
 */
async function transcribePart(
	settings: MeetingSummarySettings,
	part: AudioPart,
	label: string,
	onProgress?: (message: string) => void,
): Promise<TranscriptionResult> {
	try {
		return await runProvider(settings, part);
	} catch (error) {
		console.error(`Meeting summary: ${label} failed, retrying`, error);
		onProgress?.(`Retrying ${label}…`);
		return runProvider(settings, part);
	}
}

/**
 * Transcribes every part in order and stitches the results into one transcript,
 * shifting each part's timestamps by its offset. Parts go one at a time, so a
 * two-hour meeting does not open a dozen simultaneous uploads.
 *
 * A part that fails twice becomes a gap rather than failing the meeting: the
 * rest of the transcript is still worth having.
 */
export async function transcribe(
	settings: MeetingSummarySettings,
	request: TranscribeRequest,
): Promise<TranscriptionResult> {
	const { parts, onProgress } = request;
	if (parts.length === 0) {
		throw new Error('There is no audio to transcribe.');
	}

	const segments: TranscriptSegment[] = [];
	const gaps: TranscriptGap[] = [];
	let provider: string = settings.transcriptionProvider;
	let model = '';
	let language: string | undefined;
	let diarised = true;
	let succeeded = 0;
	let firstError: Error | null = null;

	for (const [index, part] of parts.entries()) {
		const label =
			parts.length > 1 ? `part ${index + 1} of ${parts.length}` : 'audio';
		onProgress?.(
			parts.length > 1 ? `Transcribing ${label}…` : 'Transcribing audio…',
		);

		try {
			const result = await transcribePart(settings, part, label, onProgress);
			succeeded++;
			provider = result.provider;
			model = result.model;
			language = language ?? result.language;
			diarised = diarised && result.diarised;

			for (const segment of result.segments) {
				segments.push({
					...segment,
					start: segment.start + part.offsetSeconds,
					end: segment.end + part.offsetSeconds,
				});
			}
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			firstError = firstError ?? failure;
			gaps.push({
				start: part.offsetSeconds,
				end: part.offsetSeconds + part.durationSeconds,
				reason: failure.message,
			});
			console.error(`Meeting summary: ${label} could not be transcribed`, error);
		}
	}

	if (succeeded === 0) {
		throw firstError ?? new Error('Transcription failed.');
	}

	const last = parts[parts.length - 1];
	let result: TranscriptionResult = {
		segments,
		provider,
		model,
		diarised,
		...(language ? { language } : {}),
		...(last
			? { durationSeconds: last.offsetSeconds + last.durationSeconds }
			: {}),
		...(gaps.length > 0 ? { gaps } : {}),
	};

	if (!result.diarised && settings.llmDiarisation && settings.anthropicApiKey) {
		onProgress?.('Attributing speakers…');
		const labelled = await diariseWithClaude(
			settings,
			result.segments,
			onProgress,
		);
		result = { ...result, segments: labelled, diarised: true };
	}

	const names = parseSpeakerNames(settings.speakerNames);
	if (names.length > 0) {
		result = { ...result, segments: applySpeakerNames(result.segments, names) };
	}

	return result;
}
