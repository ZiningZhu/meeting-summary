import { requestUrl } from 'obsidian';
import { MeetingSummarySettings } from '../settings';
import { TranscriptSegment, TranscriptionResult } from '../types';
import { buildMultipartBody } from '../utils/multipart';

interface WhisperSegment {
	start?: number;
	end?: number;
	text?: string;
}

interface WhisperResponse {
	text?: string;
	language?: string;
	duration?: number;
	segments?: WhisperSegment[];
	error?: { message?: string };
}

/**
 * Transcribes against any OpenAI-compatible `/audio/transcriptions` endpoint.
 * These return no speaker labels, so every segment comes back as "Speaker 1";
 * attribution is added afterwards by `diariseWithClaude` when enabled.
 */
export async function transcribeWithWhisper(
	settings: MeetingSummarySettings,
	audio: ArrayBuffer,
	mimeType: string,
	fileName: string,
): Promise<TranscriptionResult> {
	if (!settings.whisperApiKey) {
		throw new Error('Add your transcription API key in the plugin settings.');
	}

	const { body, contentType } = buildMultipartBody(
		{
			model: settings.whisperModel,
			response_format: 'verbose_json',
			'timestamp_granularities[]': 'segment',
		},
		{
			fieldName: 'file',
			fileName,
			contentType: mimeType,
			data: audio,
		},
	);

	const response = await requestUrl({
		url: `${settings.whisperBaseUrl}/audio/transcriptions`,
		method: 'POST',
		headers: {
			Authorization: `Bearer ${settings.whisperApiKey}`,
			'Content-Type': contentType,
		},
		body,
		throw: false,
	});

	let payload: WhisperResponse;
	try {
		payload = JSON.parse(response.text) as WhisperResponse;
	} catch {
		throw new Error(
			`Transcription service returned an unreadable response (HTTP ${response.status}).`,
		);
	}

	if (response.status >= 400) {
		throw new Error(
			`Transcription error (HTTP ${response.status}): ${payload.error?.message ?? response.text.slice(0, 300)}`,
		);
	}

	const raw = payload.segments ?? [];
	let segments: TranscriptSegment[] = raw
		.filter((segment) => (segment.text ?? '').trim().length > 0)
		.map((segment) => ({
			speaker: 'Speaker 1',
			start: segment.start ?? 0,
			end: segment.end ?? segment.start ?? 0,
			text: (segment.text ?? '').trim(),
		}));

	if (segments.length === 0) {
		// Endpoints that ignore `verbose_json` still return a flat `text` field.
		const flat = (payload.text ?? '').trim();
		if (flat.length === 0) {
			throw new Error('The transcription service returned an empty transcript.');
		}
		segments = [
			{ speaker: 'Speaker 1', start: 0, end: payload.duration ?? 0, text: flat },
		];
	}

	return {
		segments,
		provider: 'whisper',
		model: settings.whisperModel,
		language: payload.language,
		durationSeconds: payload.duration,
		diarised: false,
	};
}
