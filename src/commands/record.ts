import { Notice, TFile } from 'obsidian';
import type MeetingSummaryPlugin from '../main';
import { AudioRecorder } from '../audio/recorder';
import { createMeetingNote, saveRecording } from '../notes/note-writer';
import { transcribe } from '../transcription';
import { formatTimestamp, timestampForFilename } from '../utils/format';
import { summarizeFile } from './summarize';

/**
 * Owns the record → transcribe → note pipeline, plus the status bar and ribbon
 * affordances that reflect its state.
 */
export class RecordingController {
	private readonly plugin: MeetingSummaryPlugin;
	private readonly recorder = new AudioRecorder();
	private statusBarEl: HTMLElement | null = null;
	private ribbonEl: HTMLElement | null = null;
	private tickInterval: number | null = null;
	private processing = false;

	constructor(plugin: MeetingSummaryPlugin) {
		this.plugin = plugin;
	}

	get isRecording(): boolean {
		return this.recorder.isRecording;
	}

	get isBusy(): boolean {
		return this.processing;
	}

	setStatusBarEl(el: HTMLElement): void {
		this.statusBarEl = el;
		this.render();
	}

	setRibbonEl(el: HTMLElement): void {
		this.ribbonEl = el;
		this.render();
	}

	async toggle(): Promise<void> {
		if (this.processing) {
			new Notice('Still processing the previous recording.');
			return;
		}
		if (this.recorder.isRecording) {
			await this.stop();
		} else {
			await this.start();
		}
	}

	async start(): Promise<void> {
		if (this.recorder.isRecording) {
			new Notice('Already recording.');
			return;
		}
		try {
			await this.recorder.start();
		} catch (error) {
			new Notice(errorMessage(error), 8000);
			return;
		}

		new Notice('Recording started.');
		this.tickInterval = window.setInterval(() => this.render(), 1000);
		this.plugin.registerInterval(this.tickInterval);
		this.render();
	}

	/** Stops recording and runs transcription, note creation, and summary. */
	async stop(): Promise<void> {
		if (!this.recorder.isRecording) {
			new Notice('No recording is running.');
			return;
		}

		this.processing = true;
		this.clearTick();
		this.render();

		const progress = new Notice('Finishing recording…', 0);
		let recovery: (() => Promise<void>) | null = null;

		try {
			const recording = await this.recorder.stop();
			const date = new Date();

			// If anything downstream fails, keep the captured audio rather than
			// discarding an unrepeatable meeting.
			recovery = async () => {
				const rescued = await saveRecording(
					this.plugin.app,
					this.plugin.settings,
					recording.data,
					recording.extension,
					date,
				);
				new Notice(`Recording kept at ${rescued.path}`, 10000);
			};

			let audioFile: TFile | null = null;
			if (this.plugin.settings.saveAudio) {
				progress.setMessage('Saving audio…');
				audioFile = await saveRecording(
					this.plugin.app,
					this.plugin.settings,
					recording.data,
					recording.extension,
					date,
				);
				recovery = null; // Already on disk.
			}

			const result = await transcribe(this.plugin.settings, {
				audio: recording.data,
				mimeType: recording.mimeType,
				fileName: `Meeting ${timestampForFilename(date)}.${recording.extension}`,
				onProgress: (message) => progress.setMessage(message),
			});

			progress.setMessage('Writing note…');
			const note = await createMeetingNote(
				this.plugin.app,
				this.plugin.settings,
				{
					result,
					date,
					durationSeconds: result.durationSeconds ?? recording.durationSeconds,
					...(audioFile ? { audioPath: audioFile.path } : {}),
				},
			);

			await this.plugin.app.workspace.getLeaf(false).openFile(note);

			if (this.plugin.settings.autoSummarize) {
				progress.setMessage('Summarising…');
				await summarizeFile(this.plugin, note);
				progress.hide();
				new Notice('Meeting transcribed and summarised.');
			} else {
				progress.hide();
				new Notice('Meeting transcribed.');
			}
		} catch (error) {
			progress.hide();
			new Notice(errorMessage(error), 10000);
			console.error('Meeting summary: recording pipeline failed', error);
			if (recovery) {
				try {
					await recovery();
				} catch (saveError) {
					new Notice('The recording could not be saved.', 10000);
					console.error('Meeting summary: could not save audio', saveError);
				}
			}
		} finally {
			this.processing = false;
			this.render();
		}
	}

	/** Discards the in-progress recording without transcribing it. */
	cancel(): void {
		if (!this.recorder.isRecording) {
			new Notice('No recording is running.');
			return;
		}
		this.recorder.cancel();
		this.clearTick();
		this.render();
		new Notice('Recording discarded.');
	}

	dispose(): void {
		this.clearTick();
		this.recorder.cancel();
	}

	private clearTick(): void {
		if (this.tickInterval !== null) {
			window.clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
	}

	private render(): void {
		if (this.statusBarEl) {
			if (this.recorder.isRecording) {
				this.statusBarEl.setText(
					`● Recording ${formatTimestamp(this.recorder.elapsedSeconds)}`,
				);
			} else if (this.processing) {
				this.statusBarEl.setText('Processing meeting…');
			} else {
				this.statusBarEl.setText('');
			}
			this.statusBarEl.toggleClass(
				'meeting-summary-recording',
				this.recorder.isRecording,
			);
		}

		this.ribbonEl?.toggleClass(
			'meeting-summary-recording',
			this.recorder.isRecording,
		);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
