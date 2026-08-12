import { App, PluginSettingTab, Setting } from 'obsidian';
import type MeetingSummaryPlugin from './main';

export type TranscriptionProviderId = 'deepgram' | 'whisper';
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_SUMMARY_PROMPT = `Summarise the meeting transcript below in Markdown. Use only these sections, and omit any section that has no content:

## Overview
Two to four sentences on what the meeting was about and where it landed.

## Key points
Bullets, grouped by topic. Attribute positions to the speaker who took them.

## Decisions
Bullets. State what was decided and by whom. Only include settled decisions.

## Action items
A table with the columns Owner, Action, Due. Use "Unassigned" or "Not stated" when the transcript does not say.

## Open questions
Bullets for anything raised but unresolved.

Ground every statement in the transcript — do not infer commitments, dates, or outcomes that were not spoken. If the transcript is too short or garbled to summarise, say so plainly instead of guessing.`;

export interface MeetingSummarySettings {
	// Anthropic (summarisation, and speaker attribution when the transcription
	// provider does not diarise).
	anthropicApiKey: string;
	model: string;
	effort: EffortLevel;
	summaryPrompt: string;

	// Transcription.
	transcriptionProvider: TranscriptionProviderId;
	deepgramApiKey: string;
	deepgramModel: string;
	whisperApiKey: string;
	whisperBaseUrl: string;
	whisperModel: string;
	/** Ask Claude to attribute speakers when the provider returns none. */
	llmDiarisation: boolean;
	/** Comma-separated real names, in order of first appearance. */
	speakerNames: string;

	// Output.
	noteFolder: string;
	audioFolder: string;
	saveAudio: boolean;
	includeTimestamps: boolean;
	autoSummarize: boolean;
}

export const DEFAULT_SETTINGS: MeetingSummarySettings = {
	anthropicApiKey: '',
	model: 'claude-opus-5',
	effort: 'high',
	summaryPrompt: DEFAULT_SUMMARY_PROMPT,

	transcriptionProvider: 'deepgram',
	deepgramApiKey: '',
	deepgramModel: 'nova-3',
	whisperApiKey: '',
	whisperBaseUrl: 'https://api.openai.com/v1',
	whisperModel: 'whisper-1',
	llmDiarisation: true,
	speakerNames: '',

	noteFolder: 'Meetings',
	audioFolder: 'Meetings/Recordings',
	saveAudio: true,
	includeTimestamps: true,
	autoSummarize: true,
};

export class MeetingSummarySettingTab extends PluginSettingTab {
	plugin: MeetingSummaryPlugin;

	constructor(app: App, plugin: MeetingSummaryPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Transcription').setHeading();

		new Setting(containerEl)
			.setName('Provider')
			.setDesc(
				'Deepgram labels speakers itself. A Whisper-compatible endpoint does not, so speakers are attributed by Claude afterwards.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('deepgram', 'Deepgram')
					.addOption('whisper', 'Whisper-compatible')
					.setValue(this.plugin.settings.transcriptionProvider)
					.onChange(async (value) => {
						this.plugin.settings.transcriptionProvider =
							value as TranscriptionProviderId;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.transcriptionProvider === 'deepgram') {
			new Setting(containerEl)
				.setName('Deepgram API key')
				.setDesc('Sent to api.deepgram.com with each recording.')
				.addText((text) =>
					text
						.setPlaceholder('Enter your Deepgram API key')
						.setValue(this.plugin.settings.deepgramApiKey)
						.onChange(async (value) => {
							this.plugin.settings.deepgramApiKey = value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName('Deepgram model')
				.addText((text) =>
					text
						.setPlaceholder('nova-3')
						.setValue(this.plugin.settings.deepgramModel)
						.onChange(async (value) => {
							this.plugin.settings.deepgramModel =
								value.trim() || DEFAULT_SETTINGS.deepgramModel;
							await this.plugin.saveSettings();
						}),
				);
		} else {
			new Setting(containerEl)
				.setName('Transcription API key')
				.addText((text) =>
					text
						.setPlaceholder('Enter your API key')
						.setValue(this.plugin.settings.whisperApiKey)
						.onChange(async (value) => {
							this.plugin.settings.whisperApiKey = value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName('Base URL')
				.setDesc(
					'Any endpoint exposing /audio/transcriptions. Point this at a local server to keep audio off third-party services.',
				)
				.addText((text) =>
					text
						.setPlaceholder('https://api.openai.com/v1')
						.setValue(this.plugin.settings.whisperBaseUrl)
						.onChange(async (value) => {
							this.plugin.settings.whisperBaseUrl =
								value.trim().replace(/\/+$/, '') ||
								DEFAULT_SETTINGS.whisperBaseUrl;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName('Transcription model')
				.setDesc('Must support verbose_json output for timestamps.')
				.addText((text) =>
					text
						.setPlaceholder('whisper-1')
						.setValue(this.plugin.settings.whisperModel)
						.onChange(async (value) => {
							this.plugin.settings.whisperModel =
								value.trim() || DEFAULT_SETTINGS.whisperModel;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName('Attribute speakers with Claude')
				.setDesc(
					'Infers speaker turns from the transcript. Less reliable than acoustic diarisation, and sends the transcript to Anthropic.',
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.llmDiarisation)
						.onChange(async (value) => {
							this.plugin.settings.llmDiarisation = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName('Speaker names')
			.setDesc(
				'Comma-separated, in order of first speaking turn. Leave empty to keep "Speaker 1", "Speaker 2", and so on.',
			)
			.addText((text) =>
				text
					.setPlaceholder('Ada, Grace, Alan')
					.setValue(this.plugin.settings.speakerNames)
					.onChange(async (value) => {
						this.plugin.settings.speakerNames = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Summarisation').setHeading();

		new Setting(containerEl)
			.setName('Anthropic API key')
			.setDesc('Used for summaries, and for speaker attribution when enabled.')
			.addText((text) =>
				text
					.setPlaceholder('sk-ant-...')
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Model')
			.addText((text) =>
				text
					.setPlaceholder('claude-opus-5')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Effort')
			.setDesc('Higher effort produces more thorough summaries at higher cost.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('low', 'Low')
					.addOption('medium', 'Medium')
					.addOption('high', 'High')
					.addOption('xhigh', 'Extra high')
					.addOption('max', 'Max')
					.setValue(this.plugin.settings.effort)
					.onChange(async (value) => {
						this.plugin.settings.effort = value as EffortLevel;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Summary instructions')
			.setDesc('Sent ahead of the transcript. Edit to change the output shape.')
			.addTextArea((text) => {
				text
					.setValue(this.plugin.settings.summaryPrompt)
					.onChange(async (value) => {
						this.plugin.settings.summaryPrompt =
							value.trim() || DEFAULT_SUMMARY_PROMPT;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 12;
				text.inputEl.addClass('meeting-summary-prompt-input');
			});

		new Setting(containerEl)
			.setName('Summarise after transcribing')
			.setDesc('Runs the summary automatically once a recording is transcribed.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSummarize)
					.onChange(async (value) => {
						this.plugin.settings.autoSummarize = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Output').setHeading();

		new Setting(containerEl)
			.setName('Note folder')
			.setDesc('Created if it does not exist.')
			.addText((text) =>
				text
					.setPlaceholder('Meetings')
					.setValue(this.plugin.settings.noteFolder)
					.onChange(async (value) => {
						this.plugin.settings.noteFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Keep the audio file')
			.setDesc('Saves the recording in the vault and links it from the note.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.saveAudio)
					.onChange(async (value) => {
						this.plugin.settings.saveAudio = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.saveAudio) {
			new Setting(containerEl)
				.setName('Audio folder')
				.addText((text) =>
					text
						.setPlaceholder('Meetings/Recordings')
						.setValue(this.plugin.settings.audioFolder)
						.onChange(async (value) => {
							this.plugin.settings.audioFolder = value.trim();
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName('Timestamps in transcript')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeTimestamps)
					.onChange(async (value) => {
						this.plugin.settings.includeTimestamps = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setDesc(
			'This plugin sends recorded audio to your chosen transcription provider and transcript text to Anthropic. Both are third-party services — do not record meetings without the consent of everyone present.',
		);
	}
}
