import { diariseWithClaude } from '../llm/diarise';
import { MeetingSummarySettings } from '../settings';
import { TranscriptionResult } from '../types';
import { applySpeakerNames, parseSpeakerNames } from '../utils/format';
import { transcribeWithDeepInfra } from './deepinfra';
import { transcribeWithWhisper } from './whisper';

export interface TranscribeRequest {
	audio: ArrayBuffer;
	mimeType: string;
	fileName: string;
	onProgress?: (message: string) => void;
}

/**
 * Runs the configured transcription provider, adds speaker attribution when
 * the provider does not supply it, and applies the user's speaker names.
 */
export async function transcribe(
	settings: MeetingSummarySettings,
	request: TranscribeRequest,
): Promise<TranscriptionResult> {
	const { audio, mimeType, fileName, onProgress } = request;

	onProgress?.('Transcribing audio…');
	let result =
		settings.transcriptionProvider === 'deepinfra'
			? await transcribeWithDeepInfra(settings, audio, mimeType, fileName)
			: await transcribeWithWhisper(settings, audio, mimeType, fileName);

	if (!result.diarised && settings.llmDiarisation && settings.anthropicApiKey) {
		onProgress?.('Attributing speakers…');
		const segments = await diariseWithClaude(
			settings,
			result.segments,
			onProgress,
		);
		result = { ...result, segments, diarised: true };
	}

	const names = parseSpeakerNames(settings.speakerNames);
	if (names.length > 0) {
		result = { ...result, segments: applySpeakerNames(result.segments, names) };
	}

	return result;
}
