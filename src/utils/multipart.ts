/**
 * Minimal `multipart/form-data` encoder.
 *
 * Obsidian's `requestUrl` accepts only a string or an ArrayBuffer body, so the
 * browser `FormData` object cannot be used for file uploads. `requestUrl` is
 * still preferable to `fetch` here because it is not subject to CORS.
 */

export interface MultipartFile {
	fieldName: string;
	fileName: string;
	contentType: string;
	data: ArrayBuffer;
}

export interface MultipartBody {
	body: ArrayBuffer;
	contentType: string;
}

/** Builds a multipart body from simple text fields plus one binary file. */
export function buildMultipartBody(
	fields: Record<string, string>,
	file: MultipartFile,
): MultipartBody {
	const boundary = `----ObsidianMeetingSummary${Date.now().toString(16)}`;
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];

	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			encoder.encode(
				`--${boundary}\r\n` +
					`Content-Disposition: form-data; name="${name}"\r\n\r\n` +
					`${value}\r\n`,
			),
		);
	}

	parts.push(
		encoder.encode(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\n` +
				`Content-Type: ${file.contentType}\r\n\r\n`,
		),
	);
	parts.push(new Uint8Array(file.data));
	parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const body = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		body.set(part, offset);
		offset += part.byteLength;
	}

	return {
		body: body.buffer,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}
