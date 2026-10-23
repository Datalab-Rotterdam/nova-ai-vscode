import { describe, expect, it } from 'vitest';
import { toCsv, toXlsx } from '../src/panel/tableExport';

describe('tableExport', () => {
    it('writes CSV with quoting and a byte order mark', () => {
        expect(toCsv([['Name', 'Note'], ['a,b', 'say "hi"'], ['x', 'two\nlines']]))
            .toBe('﻿Name,Note\r\n"a,b","say ""hi"""\r\nx,"two\nlines"\r\n');
    });

    it('does not let CSV cells run as formulas, but keeps numbers', () => {
        const csv = toCsv([['=SUM(A1)', '@cmd', '-5', '+1.5', '-abc']]);
        expect(csv).toBe("﻿'=SUM(A1),'@cmd,-5,+1.5,'-abc\r\n");
    });

    it('writes a zip with the workbook parts', () => {
        const bytes = toXlsx([['Name', 'Qty'], ['<a&b>', '12'], ['007', '-1.5']]);
        const text = Buffer.from(bytes).toString('utf8');
        expect(Buffer.from(bytes.slice(0, 4)).toString('hex')).toBe('504b0304');
        expect(text).toContain('xl/worksheets/sheet1.xml');
        expect(text).toContain('&#60;a&#38;b&#62;');
        expect(text).toContain('<c r="B2"><v>12</v></c>');
        expect(text).toContain('<c r="B3"><v>-1.5</v></c>');
        expect(text).toMatch(/<c r="A3" t="inlineStr"><is><t xml:space="preserve">007</);
    });
});
