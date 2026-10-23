import { describe, expect, it } from 'vitest';
import { descriptionHtml, descriptionText } from '../webview/src/chat/modelDescription';

describe('model descriptions', () => {
    it('keeps strong, em and code and drops the rest', () => {
        expect(descriptionHtml('<p><strong>Qwen</strong> is <em>fast</em></p><p>and <code>big</code></p>'))
            .toBe('<strong>Qwen</strong> is <em>fast</em> and <code>big</code>');
    });

    it('never lets script or attributes through', () => {
        expect(descriptionHtml('<strong onclick="x()">a</strong><script>alert(1)</script> &lt;b&gt;'))
            .toBe('<strong>a</strong>alert(1) &lt;b&gt;');
    });

    it('gives plain text for tooltips', () => {
        expect(descriptionText('<p><strong>Qwen</strong> &amp; co</p>')).toBe('Qwen & co');
    });
});
