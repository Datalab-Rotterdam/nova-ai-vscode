import { describe, expect, it } from 'vitest';
import { fileIcon } from '../webview/src/chat/fileIcon';

describe('fileIcon', () => {
    it('picks an icon by extension, ignoring the folder and a selection range', () => {
        expect(fileIcon('src/panel/ChatController.ts')).toEqual({ icon: 'file-code', tone: 'code' });
        expect(fileIcon('src/a.ts:10-20').icon).toBe('file-code');
        expect(fileIcon('package.json').icon).toBe('json');
        expect(fileIcon('docs/README.MD').icon).toBe('markdown');
        expect(fileIcon('shot.PNG').tone).toBe('media');
    });

    it('knows a few special names and falls back to a plain file', () => {
        expect(fileIcon('Dockerfile').icon).toBe('file-code');
        expect(fileIcon('.gitignore').icon).toBe('settings-gear');
        expect(fileIcon('weird.zzz')).toEqual({ icon: 'file', tone: 'plain' });
        expect(fileIcon('noextension')).toEqual({ icon: 'file', tone: 'plain' });
    });
});
