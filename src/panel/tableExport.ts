/*
 * Tables from chat answers as CSV or Excel (.xlsx). No dependencies: an .xlsx is a zip of a few
 * XML files, written here without compression. Pure functions, so they can be tested without VS Code.
 */

export type TableRows = string[][];

/** Cells starting with these are run as formulas by spreadsheet programs. */
const FORMULA_START = /^(?:[=@\t\r]|[+-](?![\d.,]+$))/;

/** CSV with a byte order mark (Excel then reads UTF-8) and CRLF line ends. Formula-like cells get a leading apostrophe. */
export function toCsv(rows: TableRows): string {
    const cell = (value: string): string => {
        const safe = FORMULA_START.test(value) ? `'${value}` : value;
        return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive of the given files, stored uncompressed. */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.name);
        const crc = crc32(file.data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true); // version needed
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint32(14, crc, true);
        local.setUint32(18, file.data.length, true);
        local.setUint32(22, file.data.length, true);
        local.setUint16(26, name.length, true);
        parts.push(new Uint8Array(local.buffer), name, file.data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, file.data.length, true);
        entry.setUint32(24, file.data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);
        offset += 30 + name.length + file.data.length;
    }
    const centralSize = central.reduce((total, part) => total + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const result = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
    let position = 0;
    for (const part of all) {
        result.set(part, position);
        position += part.length;
    }
    return result;
}

const escapeXml = (value: string) =>
    // Control characters other than tab and newline are not allowed in XML.
    value.replace(/[^\t\n\r -퟿-�]/g, '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A numeric cell is a plain number, so Excel can sum it; "007" and "1,5" stay text. */
const NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/;

function columnName(index: number): string {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
}

/** An .xlsx workbook with one sheet "Table". The first row is bold; text is never run as a formula. */
export function toXlsx(rows: TableRows): Uint8Array {
    const encoder = new TextEncoder();
    const sheetRows = rows.map((row, r) => {
        const cells = row.map((value, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            const style = r === 0 ? ' s="1"' : '';
            if (r > 0 && NUMBER.test(value)) {
                return `<c r="${ref}"${style}><v>${value}</v></c>`;
            }
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        });
        return `<row r="${r + 1}">${cells.join('')}</row>`;
    });
    const widths = rows.reduce<number[]>((result, row) => {
        row.forEach((value, c) => {
            result[c] = Math.min(60, Math.max(result[c] ?? 8, value.length + 2));
        });
        return result;
    }, []);
    const cols = widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('');
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const files: Record<string, string> = {
        '[Content_Types].xml': `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
        '_rels/.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        'xl/workbook.xml': `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Table" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
        'xl/styles.xml': `${xml}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
        'xl/worksheets/sheet1.xml': `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetRows.join('')}</sheetData></worksheet>`
    };
    return zip(Object.entries(files).map(([name, content]) => ({ name, data: encoder.encode(content) })));
}
