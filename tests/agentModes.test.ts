import { describe, expect, it } from 'vitest';
import { nextAgentId, permissionOption } from '../src/panel/agentModes';

describe('nextAgentId', () => {
    const agents = [{ id: 'interactive' }, { id: 'plan' }, { id: 'autopilot' }];

    it('cycles and wraps', () => {
        expect(nextAgentId(agents, 'interactive')).toBe('plan');
        expect(nextAgentId(agents, 'plan')).toBe('autopilot');
        expect(nextAgentId(agents, 'autopilot')).toBe('interactive');
    });

    it('starts at the second entry for an unknown id and handles an empty list', () => {
        expect(nextAgentId(agents, 'gone')).toBe('interactive');
        expect(nextAgentId([], 'x')).toBeUndefined();
    });
});

describe('permissionOption', () => {
    it('maps every approval mode', () => {
        expect(permissionOption('ask').label).toBe('Manual permissions');
        expect(permissionOption('autoReadOnly').experimental).toBe(true);
        expect(permissionOption('autoAll').icon).toBe('warning');
    });
});
