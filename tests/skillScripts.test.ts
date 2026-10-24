import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toXlsx, zip } from '../src/panel/tableExport';

/*
 * The reading scripts of the bundled document skills (@datalabrotterdam/nova-ai-skills, skills/<name>/scripts) use only Python's
 * standard library; these tests run them on small files built here. Skipped where python3 is not installed.
 */

const python = spawnSync('python3', ['--version']).status === 0;
const SKILLS = join(__dirname, '..', 'node_modules', '@datalabrotterdam', 'nova-ai-skills', 'skills');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const encode = (text: string) => new TextEncoder().encode(text);

const docx = (text: string) => zip([
    { name: 'word/document.xml', data: encode(`<w:document ${W}><w:body>
<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Deliver within ${text} days.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Law is </w:t></w:r><w:del w:id="5" w:author="Carol" w:date="2025-02-01T09:00:00Z"><w:r><w:delText>Dutch</w:delText></w:r></w:del><w:ins w:id="6" w:author="Carol" w:date="2025-02-01T09:00:00Z"><w:r><w:t>English</w:t></w:r></w:ins></w:p>
</w:body></w:document>`) },
    { name: 'word/comments.xml', data: encode(`<w:comments ${W}>
<w:comment w:id="0" w:author="Ada" w:date="2025-01-31T10:00:00Z"><w:p w14:paraId="0000000A"><w:r><w:t>Shorter?</w:t></w:r></w:p></w:comment>
<w:comment w:id="1" w:author="Bob" w:date="2025-01-31T11:00:00Z"><w:p w14:paraId="0000000B"><w:r><w:t>Agreed.</w:t></w:r></w:p></w:comment></w:comments>`) },
    { name: 'word/commentsExtended.xml', data: encode(`<w15:commentsEx ${W}><w15:commentEx w15:paraId="0000000A" w15:done="1"/><w15:commentEx w15:paraId="0000000B" w15:paraIdParent="0000000A" w15:done="1"/></w15:commentsEx>`) },
    { name: 'docProps/core.xml', data: encode('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Contract</dc:title><dc:creator>Ada</dc:creator></cp:coreProperties>') }
]);

let dir: string;
const file = (name: string, data: Uint8Array) => {
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
};
const run = (skill: string, script: string, ...args: string[]) => {
    const result = spawnSync('python3', [join(SKILLS, skill, 'scripts', script), ...args], { encoding: 'utf8' });
    return `${result.stdout}${result.stderr}`;
};

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'nova-skill-scripts-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!python)('document skill scripts', () => {
    it('docx_review lists comments with replies and state, and tracked changes', () => {
        const output = run('nova-docx', 'docx_review.py', file('a.docx', docx('30')));
        expect(output).toContain('#0 Ada 2025-01-31T10:00:00Z [resolved]');
        expect(output).toContain('on: "Deliver within 30 days."');
        expect(output).toContain('-> #1 Bob 2025-01-31T11:00:00Z: Agreed.');
        expect(output).toContain('deleted "Dutch" by Carol');
        expect(output).toContain('inserted "English" by Carol');
    });

    it('docx_diff shows a changed number word by word; office_meta reads the properties and what is hidden', () => {
        const output = run('nova-docx', 'docx_diff.py', file('a.docx', docx('30')), file('b.docx', docx('14')), '--review');
        expect(output).toContain('Deliver within [-30-]{+14+} days.');
        const meta = run('nova-docx', 'office_meta.py', join(dir, 'a.docx'));
        expect(meta).toContain('Title: Contract');
        expect(meta).toContain('Author: Ada');
        expect(meta).toContain('tracked changes: 1 ins, 1 del');
    });

    it('xlsx_diff lists the cells that changed, were added and removed', () => {
        const before = file('a.xlsx', toXlsx([['Region', 'Q1'], ['EU', '100'], ['US', '80']]));
        const after = file('b.xlsx', toXlsx([['Region', 'Q1', 'Note'], ['EU', '150'], ['US', '80']]));
        const output = run('nova-xlsx', 'xlsx_diff.py', before, after);
        expect(output).toContain("B2: '100' -> '150'");
        expect(output).toContain("C1: added 'Note'");
    });

    it('explain what is wrong with a file of the wrong kind instead of failing with a traceback', () => {
        expect(run('nova-xlsx', 'xlsx_dump.py', join(dir, 'a.docx'))).toContain('not an .xlsx workbook');
        expect(run('nova-docx', 'docx_review.py', join(dir, 'a.xlsx'))).not.toContain('Traceback');
    });
});
