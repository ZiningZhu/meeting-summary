import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { RecordingController } from './commands/record';
import {
	DEFAULT_SETTINGS,
	MeetingSummarySettingTab,
	MeetingSummarySettings,
} from './settings';

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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MeetingSummarySettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
