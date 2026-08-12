import { requestUrl } from 'obsidian';
import { MeetingSummarySettings } from '../settings';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Model families that accept `thinking: {type: "adaptive"}` and
 * `output_config.effort`. Older models reject both with a 400, and the model
 * id is user-editable, so the parameters are sent only when recognised.
 */
const ADAPTIVE_THINKING_MODELS = [
	'claude-opus-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
	'claude-sonnet-5',
	'claude-sonnet-4-6',
	'claude-fable-5',
	'claude-mythos-5',
];

function supportsAdaptiveThinking(model: string): boolean {
	return ADAPTIVE_THINKING_MODELS.some((known) => model.startsWith(known));
}

export interface ClaudeOptions {
	system?: string;
	user: string;
	maxTokens?: number;
	/** When set, the response is constrained to this JSON Schema. */
	jsonSchema?: Record<string, unknown>;
}

interface ContentBlock {
	type: string;
	text?: string;
}

interface MessagesResponse {
	content?: ContentBlock[];
	stop_reason?: string;
	stop_details?: { category?: string | null; explanation?: string | null } | null;
	error?: { message?: string };
}

/** Calls the Messages API and returns the concatenated text blocks. */
export async function callClaude(
	settings: MeetingSummarySettings,
	options: ClaudeOptions,
): Promise<string> {
	if (!settings.anthropicApiKey) {
		throw new Error('Add your Anthropic API key in the plugin settings.');
	}

	const outputConfig: Record<string, unknown> = {};
	if (supportsAdaptiveThinking(settings.model)) {
		outputConfig.effort = settings.effort;
	}
	if (options.jsonSchema) {
		outputConfig.format = { type: 'json_schema', schema: options.jsonSchema };
	}

	const body: Record<string, unknown> = {
		model: settings.model,
		max_tokens: options.maxTokens ?? 16000,
		messages: [{ role: 'user', content: options.user }],
	};
	if (options.system) body.system = options.system;
	if (supportsAdaptiveThinking(settings.model)) {
		body.thinking = { type: 'adaptive' };
	}
	if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

	const response = await requestUrl({
		url: API_URL,
		method: 'POST',
		contentType: 'application/json',
		headers: {
			'x-api-key': settings.anthropicApiKey,
			'anthropic-version': API_VERSION,
			'content-type': 'application/json',
		},
		body: JSON.stringify(body),
		throw: false,
	});

	let payload: MessagesResponse;
	try {
		payload = JSON.parse(response.text) as MessagesResponse;
	} catch {
		throw new Error(
			`Anthropic API returned an unreadable response (HTTP ${response.status}).`,
		);
	}

	if (response.status >= 400) {
		throw new Error(
			`Anthropic API error (HTTP ${response.status}): ${payload.error?.message ?? response.text.slice(0, 300)}`,
		);
	}

	// A refusal is an HTTP 200 with empty or partial content — check before reading.
	if (payload.stop_reason === 'refusal') {
		const category = payload.stop_details?.category;
		throw new Error(
			`Claude declined this request${category ? ` (${category})` : ''}.`,
		);
	}

	const text = (payload.content ?? [])
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text as string)
		.join('')
		.trim();

	if (text.length === 0) {
		throw new Error('Claude returned an empty response.');
	}

	if (payload.stop_reason === 'max_tokens') {
		return `${text}\n\n> [!warning] Output was cut off at the token limit.`;
	}

	return text;
}
