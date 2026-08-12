/** Reading and rewriting `## Heading` sections inside a markdown note. */

/** Section headings this plugin owns. Renaming these orphans existing notes. */
export const TRANSCRIPT_HEADING = 'Transcript';
export const SUMMARY_HEADING = 'Summary';

const HEADING_PATTERN = /^#{1,6}\s/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

/**
 * Indexes of heading lines, ignoring anything inside a fenced code block so a
 * `## ` line in a code sample is not mistaken for a section boundary.
 */
function headingIndexes(lines: string[]): number[] {
	const indexes: number[] = [];
	let inFence = false;
	lines.forEach((line, index) => {
		if (FENCE_PATTERN.test(line)) {
			inFence = !inFence;
			return;
		}
		if (!inFence && HEADING_PATTERN.test(line)) indexes.push(index);
	});
	return indexes;
}

function findHeading(lines: string[], heading: string): number {
	const target = `## ${heading}`.toLowerCase();
	return (
		headingIndexes(lines).find(
			(index) => lines[index]?.trim().toLowerCase() === target,
		) ?? -1
	);
}

/** Index of the first line after frontmatter, or 0 when there is none. */
function bodyStart(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') return i + 1;
	}
	return 0;
}

/** Returns the body of a `## Heading` section, or null when it is absent. */
export function extractSection(content: string, heading: string): string | null {
	const lines = content.split('\n');
	const start = findHeading(lines, heading);
	if (start === -1) return null;

	const next = headingIndexes(lines).find((index) => index > start);
	return lines
		.slice(start + 1, next ?? lines.length)
		.join('\n')
		.trim();
}

/**
 * Replaces a `## Heading` section, or inserts it if missing — before
 * `insertBefore` when that heading exists, otherwise appended.
 */
export function upsertSection(
	content: string,
	heading: string,
	body: string,
	insertBefore?: string,
): string {
	const lines = content.split('\n');
	const block = [`## ${heading}`, '', body.trim(), ''];
	const start = findHeading(lines, heading);

	if (start !== -1) {
		const next = headingIndexes(lines).find((index) => index > start);
		lines.splice(start, (next ?? lines.length) - start, ...block);
		return lines.join('\n').trimEnd() + '\n';
	}

	// Place it above the anchor heading when there is one; otherwise append,
	// keeping it below any frontmatter.
	const anchor = insertBefore ? findHeading(lines, insertBefore) : -1;
	const at = anchor !== -1 ? anchor : Math.max(bodyStart(lines), lines.length);
	lines.splice(at, 0, ...block);
	return lines.join('\n').trimEnd() + '\n';
}
