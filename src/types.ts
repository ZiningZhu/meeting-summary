/** Shared data shapes passed between recording, transcription, and note writing. */

/** One contiguous span of speech attributed to a single speaker. */
export interface TranscriptSegment {
	/** Display label, e.g. "Speaker 1" or a mapped real name. */
	speaker: string;
	/** Offset from the start of the recording, in seconds. */
	start: number;
	/** End offset, in seconds. */
	end: number;
	text: string;
}

/** A stretch of the recording that produced no transcript. */
export interface TranscriptGap {
	/** Offsets from the start of the recording, in seconds. */
	start: number;
	end: number;
	reason: string;
}

export interface TranscriptionResult {
	segments: TranscriptSegment[];
	/** Identifier of the service that produced the transcript. */
	provider: string;
	/** Model name reported by (or requested from) the provider. */
	model: string;
	/** BCP-47 language tag, when the provider reports one. */
	language?: string;
	durationSeconds?: number;
	/** True when speaker labels come from the provider rather than a guess. */
	diarised: boolean;
	/** Parts that failed to transcribe, when the audio was sent in pieces. */
	gaps?: TranscriptGap[];
}
