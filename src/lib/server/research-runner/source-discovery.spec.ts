import { describe, expect, it } from 'vitest';
import { htmlToText } from './source-discovery';

describe('research source discovery', () => {
	it('extracts readable text while removing executable and styling content', () => {
		const text = htmlToText(`
			<html>
				<head><style>.hidden { display: none }</style><script>alert("no")</script></head>
				<body><h1>Leadership &amp; governance</h1><p>Jane Doe<br>Chief Executive Officer</p></body>
			</html>
		`);

		expect(text).toContain('Leadership & governance');
		expect(text).toContain('Jane Doe');
		expect(text).not.toContain('alert');
		expect(text).not.toContain('display: none');
	});
});
