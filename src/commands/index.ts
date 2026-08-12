import { MarkdownView } from 'obsidian';
import type MeetingSummaryPlugin from '../main';
import { summarizeActiveFile } from './summarize';

export function registerCommands(plugin: MeetingSummaryPlugin): void {
	plugin.addCommand({
		id: 'toggle-recording',
		name: 'Start or stop meeting recording',
		callback: () => void plugin.recording.toggle(),
	});

	plugin.addCommand({
		id: 'start-recording',
		name: 'Start meeting recording',
		checkCallback: (checking: boolean) => {
			if (plugin.recording.isRecording || plugin.recording.isBusy) return false;
			if (!checking) void plugin.recording.start();
			return true;
		},
	});

	plugin.addCommand({
		id: 'stop-recording',
		name: 'Stop recording and transcribe',
		checkCallback: (checking: boolean) => {
			if (!plugin.recording.isRecording) return false;
			if (!checking) void plugin.recording.stop();
			return true;
		},
	});

	plugin.addCommand({
		id: 'discard-recording',
		name: 'Discard current recording',
		checkCallback: (checking: boolean) => {
			if (!plugin.recording.isRecording) return false;
			if (!checking) plugin.recording.cancel();
			return true;
		},
	});

	plugin.addCommand({
		id: 'summarize-note',
		name: 'Summarise meeting transcript in this note',
		checkCallback: (checking: boolean) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!file) return false;
			if (!checking) void summarizeActiveFile(plugin, file);
			return true;
		},
	});
}
