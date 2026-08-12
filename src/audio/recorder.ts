/** Microphone capture via the MediaRecorder API. */

export interface RecordingResult {
	data: ArrayBuffer;
	mimeType: string;
	/** File extension matching `mimeType`, without a leading dot. */
	extension: string;
	durationSeconds: number;
}

/** Candidate containers, best first. Opus-in-WebM is the widest-supported. */
const PREFERRED_MIME_TYPES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

const EXTENSIONS: Array<[string, string]> = [
	['webm', 'webm'],
	['ogg', 'ogg'],
	['mp4', 'm4a'],
	['mpeg', 'mp3'],
	['wav', 'wav'],
];

function pickMimeType(): string | undefined {
	for (const candidate of PREFERRED_MIME_TYPES) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return undefined;
}

function extensionFor(mimeType: string): string {
	for (const [needle, extension] of EXTENSIONS) {
		if (mimeType.includes(needle)) return extension;
	}
	return 'webm';
}

export class AudioRecorder {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;

	get isRecording(): boolean {
		return this.recorder !== null && this.recorder.state !== 'inactive';
	}

	get elapsedSeconds(): number {
		return this.startedAt === 0 ? 0 : (Date.now() - this.startedAt) / 1000;
	}

	/** Requests microphone access and begins capturing. */
	async start(): Promise<void> {
		if (this.isRecording) throw new Error('A recording is already running.');
		if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			throw new Error('Audio recording is not supported on this device.');
		}

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (error) {
			throw new Error(
				`Could not access the microphone: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		const mimeType = pickMimeType();
		const recorder = new MediaRecorder(
			stream,
			mimeType ? { mimeType } : undefined,
		);

		this.chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		});

		this.stream = stream;
		this.recorder = recorder;
		this.startedAt = Date.now();
		// Flush every second so a crash loses at most one second of audio.
		recorder.start(1000);
	}

	/** Stops capturing and resolves with the assembled recording. */
	stop(): Promise<RecordingResult> {
		const recorder = this.recorder;
		if (!recorder || recorder.state === 'inactive') {
			return Promise.reject(new Error('No recording is running.'));
		}

		const durationSeconds = this.elapsedSeconds;

		return new Promise<RecordingResult>((resolve, reject) => {
			recorder.addEventListener('error', (event) => {
				this.releaseStream();
				const detail = (event as Event & { error?: DOMException }).error;
				reject(new Error(`Recording failed: ${detail?.message ?? 'unknown error'}`));
			});

			recorder.addEventListener('stop', () => {
				const mimeType = recorder.mimeType || 'audio/webm';
				const blob = new Blob(this.chunks, { type: mimeType });
				this.releaseStream();

				if (blob.size === 0) {
					reject(new Error('The recording is empty — no audio was captured.'));
					return;
				}

				blob
					.arrayBuffer()
					.then((data) =>
						resolve({
							data,
							mimeType,
							extension: extensionFor(mimeType),
							durationSeconds,
						}),
					)
					.catch(reject);
			});

			recorder.stop();
		});
	}

	/** Aborts the recording and discards captured audio. */
	cancel(): void {
		if (this.recorder && this.recorder.state !== 'inactive') {
			this.recorder.stop();
		}
		this.releaseStream();
	}

	private releaseStream(): void {
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.recorder = null;
		this.chunks = [];
		this.startedAt = 0;
	}
}
