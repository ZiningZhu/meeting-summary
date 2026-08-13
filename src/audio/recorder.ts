/** Microphone capture via the MediaRecorder API. */

/** One independently decodable slice of the recording. */
export interface RecordingPart {
	data: ArrayBuffer;
	mimeType: string;
	/** Offset from the start of the recording, in seconds. */
	offsetSeconds: number;
	durationSeconds: number;
}

export interface RecordingResult {
	/** The whole recording, for saving to the vault. */
	data: ArrayBuffer;
	mimeType: string;
	/** File extension matching `mimeType`, without a leading dot. */
	extension: string;
	durationSeconds: number;
	/** The recording split for transcription. One entry when unsegmented. */
	parts: RecordingPart[];
}

export interface RecordingOptions {
	/**
	 * Cut a transcription part this often, so a long meeting can be sent to the
	 * provider in pieces rather than as one oversized request. 0 disables it.
	 */
	segmentSeconds?: number;
	/** Input device for your own voice. Empty means the system default. */
	micDeviceId?: string;
	/** Loopback device carrying the call. Empty records the microphone alone. */
	systemDeviceId?: string;
}

/**
 * Devices disagree about sample rate — BlackHole adopts whatever rate its
 * client asks for — so the mixing graph pins one and lets WebAudio resample.
 */
const MIX_SAMPLE_RATE = 48000;

/** Headroom, so two sources at full scale do not sum past what opus can hold. */
const MIX_GAIN = 0.85;

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

function microphoneError(error: unknown): Error {
	return new Error(
		`Could not access the microphone: ${error instanceof Error ? error.message : String(error)}`,
	);
}

/**
 * Captures the microphone.
 *
 * With `segmentSeconds` set, a second recorder runs alongside the first and is
 * restarted on that interval. MediaRecorder's periodic chunks cannot be split
 * apart afterwards — only the first carries the container header — so cutting
 * at record time is what makes each part decodable on its own. The continuous
 * recorder still produces one file for the vault.
 */
export class AudioRecorder {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;

	private recorderOptions: MediaRecorderOptions | undefined;
	private segmenter: MediaRecorder | null = null;
	private segmentTimer: number | null = null;
	private segmentSeconds = 0;
	private parts: RecordingPart[] = [];
	/** Resolves once each segment's blob has been read into `parts`. */
	private pendingParts: Array<Promise<void>> = [];
	/** Set when a rotation fails, so the parts collected so far are not trusted. */
	private segmentationFailed = false;

	/** The raw device streams behind `stream`, which may be a mix of them. */
	private sourceStreams: MediaStream[] = [];
	private mixContext: AudioContext | null = null;
	/** Non-fatal problems from the last `start()`, for the caller to surface. */
	private startWarnings: string[] = [];

	get isRecording(): boolean {
		return this.recorder !== null && this.recorder.state !== 'inactive';
	}

	get elapsedSeconds(): number {
		return this.startedAt === 0 ? 0 : (Date.now() - this.startedAt) / 1000;
	}

	/** Non-fatal problems from the last `start()`, for the caller to surface. */
	get warnings(): string[] {
		return this.startWarnings;
	}

	/**
	 * Opens one input device. Loopback captures skip Chromium's voice
	 * processing: there is no echo or room noise in a digital copy of the call,
	 * and the gate would only chew holes in it.
	 */
	private openDevice(
		deviceId: string | undefined,
		loopback: boolean,
	): Promise<MediaStream> {
		const constraints: MediaTrackConstraints = {};
		if (deviceId) constraints.deviceId = { exact: deviceId };
		if (loopback) {
			constraints.echoCancellation = false;
			constraints.noiseSuppression = false;
			constraints.autoGainControl = false;
		}
		return navigator.mediaDevices.getUserMedia({
			audio: Object.keys(constraints).length > 0 ? constraints : true,
		});
	}

	/** Sums the streams into one mono track for the recorders to consume. */
	private mix(streams: MediaStream[]): MediaStream {
		const context = new AudioContext({ sampleRate: MIX_SAMPLE_RATE });
		this.mixContext = context;

		// The output stream takes its channel count at construction, so mono has
		// to be asked for here rather than set afterwards. Speech recognition
		// gains nothing from two channels, and mono halves what is uploaded.
		const destination = new MediaStreamAudioDestinationNode(context, {
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		for (const stream of streams) {
			const source = context.createMediaStreamSource(stream);
			const gain = context.createGain();
			gain.gain.value = MIX_GAIN;
			source.connect(gain).connect(destination);
		}

		// Contexts can come up suspended when created outside a user gesture.
		void context.resume().catch(() => undefined);
		return destination.stream;
	}

	/** Requests microphone access and begins capturing. */
	async start(options: RecordingOptions = {}): Promise<void> {
		if (this.isRecording) throw new Error('A recording is already running.');
		if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			throw new Error('Audio recording is not supported on this device.');
		}

		this.startWarnings = [];
		this.sourceStreams = [];

		let mic: MediaStream;
		try {
			mic = await this.openDevice(options.micDeviceId, false);
		} catch (error) {
			// Retry on the default device: a saved id goes stale as soon as the
			// device is unplugged, and that should not block the meeting.
			if (!options.micDeviceId) throw microphoneError(error);
			console.error('Meeting summary: configured microphone unavailable', error);
			try {
				mic = await this.openDevice(undefined, false);
				this.startWarnings.push(
					'The selected microphone was unavailable. Using the system default.',
				);
			} catch (fallbackError) {
				throw microphoneError(fallbackError);
			}
		}
		this.sourceStreams.push(mic);

		let stream = mic;
		if (options.systemDeviceId) {
			try {
				const system = await this.openDevice(options.systemDeviceId, true);
				this.sourceStreams.push(system);
				stream = this.mix([mic, system]);
			} catch (error) {
				// Losing the far end is bad, losing the meeting is worse.
				console.error('Meeting summary: meeting audio unavailable', error);
				this.startWarnings.push(
					'Meeting audio could not be captured. Recording the microphone only.',
				);
			}
		}

		const mimeType = pickMimeType();
		this.recorderOptions = mimeType ? { mimeType } : undefined;
		let recorder: MediaRecorder;
		try {
			recorder = new MediaRecorder(stream, this.recorderOptions);
		} catch (error) {
			// The devices are already open; without this they stay live, holding
			// the microphone indicator on with nothing recording.
			this.stream = stream;
			this.releaseStream();
			throw microphoneError(error);
		}

		this.chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		});

		this.stream = stream;
		this.recorder = recorder;
		this.parts = [];
		this.pendingParts = [];
		this.segmentationFailed = false;
		this.startedAt = Date.now();
		// Flush every second so a crash loses at most one second of audio.
		recorder.start(1000);

		this.segmentSeconds = Math.max(0, Math.floor(options.segmentSeconds ?? 0));
		if (this.segmentSeconds > 0) {
			try {
				this.startSegment();
			} catch (error) {
				// Transcription falls back to a single request. The continuous
				// recorder is untouched, so the meeting is still captured.
				this.segmentSeconds = 0;
				console.error(
					'Meeting summary: could not start segmented capture',
					error,
				);
			}
		}
	}

	/** Stops capturing and resolves with the assembled recording. */
	stop(): Promise<RecordingResult> {
		const recorder = this.recorder;
		if (!recorder || recorder.state === 'inactive') {
			return Promise.reject(new Error('No recording is running.'));
		}

		const durationSeconds = this.elapsedSeconds;
		this.stopSegmenter();

		return new Promise<RecordingResult>((resolve, reject) => {
			recorder.addEventListener('error', (event) => {
				this.releaseStream();
				const detail = (event as Event & { error?: DOMException }).error;
				reject(new Error(`Recording failed: ${detail?.message ?? 'unknown error'}`));
			});

			recorder.addEventListener('stop', () => {
				const mimeType = recorder.mimeType || 'audio/webm';
				const blob = new Blob(this.chunks, { type: mimeType });
				// Captured before release, which swaps in fresh collections.
				const parts = this.parts;
				const pending = this.pendingParts;
				this.releaseStream();

				if (blob.size === 0) {
					reject(new Error('The recording is empty — no audio was captured.'));
					return;
				}

				Promise.all(pending)
					.then(() => blob.arrayBuffer())
					.then((data) => {
						// Segments finish reading out of order.
						parts.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
						const whole = [
							{ data, mimeType, offsetSeconds: 0, durationSeconds },
						];
						resolve({
							data,
							mimeType,
							extension: extensionFor(mimeType),
							durationSeconds,
							parts: this.partsCover(parts, durationSeconds) ? parts : whole,
						});
					})
					.catch(reject);
			});

			recorder.stop();
		});
	}

	/** Aborts the recording and discards captured audio. */
	cancel(): void {
		this.stopSegmenter();
		if (this.recorder && this.recorder.state !== 'inactive') {
			this.recorder.stop();
		}
		this.releaseStream();
	}

	/**
	 * True when the parts account for essentially the whole recording. A failed
	 * rotation or an unreadable segment would otherwise drop that stretch from
	 * the transcript with nothing to show it was missing, so anything short of
	 * full coverage sends the recording as one piece instead.
	 */
	private partsCover(parts: RecordingPart[], durationSeconds: number): boolean {
		if (this.segmentationFailed || parts.length === 0) return false;
		const covered = parts.reduce((total, part) => total + part.durationSeconds, 0);
		return covered >= durationSeconds * 0.95;
	}

	/** Starts a fresh segment recorder and schedules the next rotation. */
	private startSegment(): void {
		const stream = this.stream;
		if (!stream) return;

		const recorder = new MediaRecorder(stream, this.recorderOptions);
		const chunks: Blob[] = [];
		const startedAt = Date.now();
		const offsetSeconds = (startedAt - this.startedAt) / 1000;
		// Bound now: `this.parts` is replaced wholesale when the stream is released.
		const sink = this.parts;

		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		});

		this.pendingParts.push(
			new Promise<void>((resolve) => {
				recorder.addEventListener(
					'stop',
					() => {
						const durationSeconds = (Date.now() - startedAt) / 1000;
						const mimeType = recorder.mimeType || 'audio/webm';
						const blob = new Blob(chunks, { type: mimeType });
						if (blob.size === 0) {
							resolve();
							return;
						}
						blob
							.arrayBuffer()
							.then((data) => {
								sink.push({ data, mimeType, offsetSeconds, durationSeconds });
							})
							.catch((error) => {
								// The continuous recording still covers this stretch.
								console.error(
									'Meeting summary: could not read a recording segment',
									error,
								);
							})
							.finally(resolve);
					},
					{ once: true },
				);
			}),
		);

		this.segmenter = recorder;
		recorder.start(1000);
		this.segmentTimer = window.setTimeout(
			() => this.rotateSegment(),
			this.segmentSeconds * 1000,
		);
	}

	/** Closes the current segment and opens the next one. */
	private rotateSegment(): void {
		this.segmentTimer = null;
		const current = this.segmenter;
		this.segmenter = null;
		if (current && current.state !== 'inactive') current.stop();
		if (!this.isRecording) return;

		try {
			this.startSegment();
		} catch (error) {
			// Every later stretch would be missing from the parts, which would
			// silently truncate the transcript. Fall back to the whole recording.
			this.segmentationFailed = true;
			console.error('Meeting summary: segmented capture stopped', error);
		}
	}

	private stopSegmenter(): void {
		if (this.segmentTimer !== null) {
			window.clearTimeout(this.segmentTimer);
			this.segmentTimer = null;
		}
		const current = this.segmenter;
		this.segmenter = null;
		if (current && current.state !== 'inactive') current.stop();
	}

	private releaseStream(): void {
		// `stream` may be the mix, whose tracks are not the device tracks: the
		// microphone stays live until every source is stopped too.
		this.stream?.getTracks().forEach((track) => track.stop());
		for (const source of this.sourceStreams) {
			source.getTracks().forEach((track) => track.stop());
		}
		this.sourceStreams = [];
		void this.mixContext?.close().catch(() => undefined);
		this.mixContext = null;
		this.stream = null;
		this.recorder = null;
		this.chunks = [];
		this.startedAt = 0;
		this.parts = [];
		this.pendingParts = [];
	}
}
