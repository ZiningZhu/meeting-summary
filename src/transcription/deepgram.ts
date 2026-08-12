import { requestUrl } from 'obsidian';
import { MeetingSummarySettings } from '../settings';
import { TranscriptSegment, TranscriptionResult } from '../types';

const API_URL = 'https://api.deepgram.com/v1/listen';

interface DeepgramUtterance {
	start?: number;
	end?: number;
	speaker?: number;
	transcript?: string;
}

interface DeepgramResponse {
	results?: {
		utterances?: DeepgramUtterance[];
		channels?: Array<{
			detected_language?: string;
			alternatives?: Array<{ transcript?: string }>;
		}>;
	};
	metadata?: { duration?: number; model_info?: unknown };
	err_msg?: string;
	error?: string;
}

/**
 * Transcribes with Deepgram, which performs acoustic diarisation server-side
 * and returns one utterance per speaker turn.
 */
export async function transcribeWithDeepgram(
	settings: MeetingSummarySettings,
	audio: ArrayBuffer,
	mimeType: string,
): Promise<TranscriptionResult> {
	if (!settings.deepgramApiKey) {
		throw new Error('Add your Deepgram API key in the plugin settings.');
	}

	const params = new URLSearchParams({
		model: settings.deepgramModel,
		diarize: 'true',
		utterances: 'true',
		punctuate: 'true',
		smart_format: 'true',
		detect_language: 'true',
	});

	const response = await requestUrl({
		url: `${API_URL}?${params.toString()}`,
		method: 'POST',
		headers: {
			Authorization: `Token ${settings.deepgramApiKey}`,
			'Content-Type': mimeType,
		},
		body: audio,
		throw: false,
	});

	let payload: DeepgramResponse;
	try {
		payload = JSON.parse(response.text) as DeepgramResponse;
	} catch {
		throw new Error(
			`Deepgram returned an unreadable response (HTTP ${response.status}).`,
		);
	}

	if (response.status >= 400) {
		throw new Error(
			`Deepgram error (HTTP ${response.status}): ${payload.err_msg ?? payload.error ?? response.text.slice(0, 300)}`,
		);
	}

	const utterances = payload.results?.utterances ?? [];
	const channel = payload.results?.channels?.[0];

	let segments: TranscriptSegment[];
	let diarised: boolean;

	if (utterances.length > 0) {
		diarised = true;
		segments = utterances
			.filter((utterance) => (utterance.transcript ?? '').trim().length > 0)
			.map((utterance) => ({
				speaker: `Speaker ${(utterance.speaker ?? 0) + 1}`,
				start: utterance.start ?? 0,
				end: utterance.end ?? utterance.start ?? 0,
				text: (utterance.transcript ?? '').trim(),
			}));
	} else {
		// Deepgram still returns a flat transcript when it detects no turns.
		const flat = (channel?.alternatives?.[0]?.transcript ?? '').trim();
		if (flat.length === 0) {
			throw new Error('Deepgram returned an empty transcript.');
		}
		diarised = false;
		segments = [
			{
				speaker: 'Speaker 1',
				start: 0,
				end: payload.metadata?.duration ?? 0,
				text: flat,
			},
		];
	}

	if (segments.length === 0) {
		throw new Error('Deepgram returned an empty transcript.');
	}

	return {
		segments,
		provider: 'deepgram',
		model: settings.deepgramModel,
		language: channel?.detected_language,
		durationSeconds: payload.metadata?.duration,
		diarised,
	};
}
