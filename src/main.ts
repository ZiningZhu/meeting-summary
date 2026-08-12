import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { RecordingController } from './commands/record';
import {
	DEFAULT_SETTINGS,
	MeetingSummarySettingTab,
	MeetingSummarySettings,
	TranscriptionProviderId,
	TRANSCRIPTION_PROVIDER_IDS,
} from './settings';

/** Settings as they may exist on disk: unknown provider ids, retired keys. */
type StoredSettings = Omit<
	Partial<MeetingSummarySettings>,
	'transcriptionProvider'
> & {
	transcriptionProvider?: string;
	deepgramApiKey?: string;
	deepgramModel?: string;
};

function isProviderId(value: string): value is TranscriptionProviderId {
	return (TRANSCRIPTION_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Brings an older `data.json` up to date. Returns true when it changed, so the
 * caller can write the cleaned-up settings back.
 */
function migrate(stored: StoredSettings): boolean {
	let changed = false;

	// Deepgram was replaced by DeepInfra. Fall back to the default rather than
	// letting a retired id select the wrong provider.
	if (
		stored.transcriptionProvider !== undefined &&
		!isProviderId(stored.transcriptionProvider)
	) {
		stored.transcriptionProvider = DEFAULT_SETTINGS.transcriptionProvider;
		changed = true;
	}

	// Don't leave the retired provider's key sitting in the vault.
	for (const key of ['deepgramApiKey', 'deepgramModel'] as const) {
		if (key in stored) {
			delete stored[key];
			changed = true;
		}
	}

	return changed;
}

export default class MeetingSummaryPlugin extends Plugin {
	settings!: MeetingSummarySettings;
	recording!: RecordingController;

	async onload() {
		await this.loadSettings();

		this.recording = new RecordingController(this);
		this.recording.setStatusBarEl(this.addStatusBarItem());
		this.recording.setRibbonEl(
			this.addRibbonIcon('mic', 'Record meeting', () => {
				void this.recording.toggle();
			}),
		);

		registerCommands(this);
		this.addSettingTab(new MeetingSummarySettingTab(this.app, this));
	}

	onunload() {
		this.recording?.dispose();
	}

	async loadSettings() {
		const stored = ((await this.loadData()) ?? {}) as StoredSettings;
		const changed = migrate(stored);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		if (changed) await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
