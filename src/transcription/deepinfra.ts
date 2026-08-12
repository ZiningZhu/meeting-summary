import { requestUrl } from 'obsidian';
import { MeetingSummarySettings } from '../settings';
import { TranscriptSegment, TranscriptionResult } from '../types';
import { buildMultipartBody } from '../utils/multipart';

const API_BASE = 'https://api.deepinfra.com/v1/inference';

interface DeepInfraSegment {
	id?: number;
	start?: number;
	end?: number;
	text?: string;
}

interface DeepInfraResponse {
	text?: string;
	segments?: DeepInfraSegment[];
	language?: string;
	duration?: number;
	input_length_ms?: number;
	inference_status?: { status?: string; runtime_ms?: number };
	/** Error shape: a message, or FastAPI-style validation entries. */
	detail?: string | Array<{ msg?: string }>;
	error?: string;
}

function errorMessage(payload: DeepInfraResponse, fallback: string): string {
	const { detail } = payload;
	if (typeof detail === 'string') return detail;
	if (Array.isArray(detail)) {
		const messages = detail.map((entry) => entry.msg).filter(Boolean);
		if (messages.length > 0) return messages.join('; ');
	}
	return payload.error ?? fallback;
}

/**
 * Transcribes with an ASR model on DeepInfra's inference API, by default
 * Qwen3-ASR. It returns Whisper-style timestamped segments and no speaker
 * labels, so every segment comes back as "Speaker 1"; attribution is added
 * afterwards by `diariseWithClaude` when enabled.
 */
export async function transcribeWithDeepInfra(
	settings: MeetingSummarySettings,
	audio: ArrayBuffer,
	mimeType: string,
	fileName: string,
): Promise<TranscriptionResult> {
	if (!settings.deepinfraApiKey) {
		throw new Error('Add your DeepInfra API key in the plugin settings.');
	}

	const { body, contentType } = buildMultipartBody(
		{},
		{
			fieldName: 'audio',
			fileName,
			contentType: mimeType,
			data: audio,
		},
	);

	const response = await requestUrl({
		url: `${API_BASE}/${settings.deepinfraModel}`,
		method: 'POST',
		headers: {
			Authorization: `bearer ${settings.deepinfraApiKey}`,
			'Content-Type': contentType,
		},
		body,
		throw: false,
	});

	let payload: DeepInfraResponse;
	try {
		payload = JSON.parse(response.text) as DeepInfraResponse;
	} catch {
		throw new Error(
			`DeepInfra returned an unreadable response (HTTP ${response.status}).`,
		);
	}

	if (response.status >= 400) {
		throw new Error(
			`DeepInfra error (HTTP ${response.status}): ${errorMessage(payload, response.text.slice(0, 300))}`,
		);
	}

	// A 200 can still carry a failed inference.
	const status = payload.inference_status?.status;
	if (status && status !== 'succeeded' && status !== 'unknown') {
		throw new Error(
			`DeepInfra inference ${status}: ${errorMessage(payload, 'no detail given')}`,
		);
	}

	const durationSeconds =
		payload.duration ??
		(payload.input_length_ms === undefined
			? undefined
			: payload.input_length_ms / 1000);

	let segments: TranscriptSegment[] = (payload.segments ?? [])
		.filter((segment) => (segment.text ?? '').trim().length > 0)
		.map((segment) => ({
			speaker: 'Speaker 1',
			start: segment.start ?? 0,
			end: segment.end ?? segment.start ?? 0,
			text: (segment.text ?? '').trim(),
		}));

	if (segments.length === 0) {
		// Short clips can come back as a bare `text` field with no segments.
		const flat = (payload.text ?? '').trim();
		if (flat.length === 0) {
			throw new Error('DeepInfra returned an empty transcript.');
		}
		segments = [
			{ speaker: 'Speaker 1', start: 0, end: durationSeconds ?? 0, text: flat },
		];
	}

	return {
		segments,
		provider: 'deepinfra',
		model: settings.deepinfraModel,
		language: payload.language,
		durationSeconds,
		diarised: false,
	};
}
