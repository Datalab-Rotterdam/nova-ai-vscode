import { describe, expect, it } from 'vitest';
import { evaluatePermissionRules } from '../src/permissions/rules';

// rules.ts is shared with nova-ai-cli; these cases mirror its policy-rules tests.
describe('tools named differently in nova-ai-cli match each other\'s rules', () => {
    it('treats create_file/write_file, list_dir/list_directory and todo_write/update_plan as one tool', () => {
        expect(evaluatePermissionRules({ allow: ['write_file(src/*)'] }, 'create_file', { path: 'src/a.ts' })).toBe('allow');
        expect(evaluatePermissionRules({ deny: ['create_file(.env)'] }, 'write_file', { path: '.env' })).toBe('deny');
        expect(evaluatePermissionRules({ deny: ['list_directory(secrets/*)'] }, 'list_dir', { path: 'secrets/keys' })).toBe('deny');
        expect(evaluatePermissionRules({ allow: ['update_plan'] }, 'todo_write', { todos: [] })).toBe('allow');
    });

    it('matches find_files on its pattern and fetch_url on its URL', () => {
        expect(evaluatePermissionRules({ deny: ['find_files(**/.env*)'] }, 'find_files', { pattern: '**/.env*' })).toBe('deny');
        expect(evaluatePermissionRules({ allow: ['fetch_url(https://docs.example.com/*)'] }, 'fetch_url', {
            url: 'https://evil.example.net/?q=secret'
        })).toBe('ask');
    });
});
