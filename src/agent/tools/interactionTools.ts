import type { QuestionOption, TodoItem } from '../../panel/protocol';
import { NovaTool, ToolInputError } from './types';

export interface InteractionHost {
    setTodos(todos: TodoItem[]): void;
    /** Shows the question and resolves with the user's answer, or undefined when skipped. */
    ask(question: { question: string; options: QuestionOption[]; multiSelect: boolean; allowOther: boolean }, token: import('vscode').CancellationToken): Promise<string | undefined>;
}

interface TodoWriteInput { todos: Array<{ content: string; status?: string }> }
interface AskUserInput { question: string; options?: Array<string | { label: string; description?: string; recommended?: boolean }>; multiSelect?: boolean; allowOther?: boolean }

const MAX_TODOS = 30;
const MAX_OPTIONS = 8;

/** Tools that only make sense in Nova's own chat panel, which renders them. */
export function createInteractionTools(host: InteractionHost): NovaTool<never>[] {
    const todoWrite: NovaTool<TodoWriteInput> = {
        name: 'todo_write',
        description:
            'Show and update a task list for multi-step work (3 or more steps). Send the complete list every time. ' +
            'Statuses: pending, in_progress (exactly one at a time), completed. Mark items completed as soon as they are done. ' +
            'Skip it for simple one-step requests.',
        inputSchema: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Short, imperative task description.' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
                        },
                        required: ['content', 'status']
                    }
                }
            },
            required: ['todos']
        },
        readOnly: true,
        async prepare(input) {
            const todos = parseTodos(input);
            const done = todos.filter((todo) => todo.status === 'completed').length;
            return { title: `Update task list (${done}/${todos.length})` };
        },
        async invoke(input) {
            const todos = parseTodos(input);
            host.setTodos(todos);
            const current = todos.find((todo) => todo.status === 'in_progress');
            return `Task list updated: ${todos.filter((todo) => todo.status === 'completed').length}/${todos.length} done` +
                (current ? `; in progress: ${current.content}` : '') + '.';
        }
    };

    const askUser: NovaTool<AskUserInput> = {
        name: 'ask_user',
        description:
            'Ask the user a question and wait for the answer. Use it only when a decision really needs the user ' +
            '(ambiguous requirements, a choice between approaches, missing information), not for things you can find out yourself. ' +
            'Prefer 2-5 concrete options, each with a one-line description of what choosing it means, and mark the option you ' +
            'recommend with recommended: true (at most one, unless multiSelect). Set multiSelect for "pick all that apply". ' +
            'The user can always type their own answer unless allowOther is false.',
        inputSchema: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question, ending with a question mark.' },
                options: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', description: 'Short option text.' },
                            description: { type: 'string', description: 'One line on what choosing this option means (trade-offs, consequences).' },
                            recommended: { type: 'boolean', description: 'True for the option you recommend.' }
                        },
                        required: ['label']
                    }
                },
                multiSelect: { type: 'boolean', description: 'Allow picking several options.' },
                allowOther: { type: 'boolean', description: 'Allow a free-text answer. Defaults to true.' }
            },
            required: ['question']
        },
        readOnly: true,
        async prepare(input) {
            return { title: 'Question for you' , detail: parseQuestion(input).question };
        },
        async invoke(input, context) {
            const answer = await host.ask(parseQuestion(input), context.token);
            return answer === undefined
                ? 'The user skipped the question. Make a reasonable choice yourself and say which one you made.'
                : `The user answered: ${answer}`;
        }
    };

    return [todoWrite, askUser] as unknown as NovaTool<never>[];
}

function parseTodos(input: TodoWriteInput): TodoItem[] {
    if (!Array.isArray(input.todos)) {
        throw new ToolInputError('"todos" must be an array of { content, status }.');
    }
    return input.todos.slice(0, MAX_TODOS).map((todo, index) => {
        const content = typeof todo?.content === 'string' ? todo.content.trim() : '';
        if (!content) {
            throw new ToolInputError(`Todo ${index + 1} needs a "content".`);
        }
        const status = todo.status === 'in_progress' || todo.status === 'completed' ? todo.status : 'pending';
        return { content, status };
    });
}

function parseQuestion(input: AskUserInput): { question: string; options: QuestionOption[]; multiSelect: boolean; allowOther: boolean } {
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (!question) {
        throw new ToolInputError('A "question" is required.');
    }
    const options = (Array.isArray(input.options) ? input.options : [])
        .slice(0, MAX_OPTIONS)
        .map((option) => (typeof option === 'string' ? { label: option } : option))
        .filter((option): option is QuestionOption => Boolean(option && typeof option.label === 'string' && option.label.trim()))
        .map((option) => ({
            label: option.label.trim(),
            ...(option.description?.trim() ? { description: option.description.trim() } : {}),
            ...(option.recommended === true ? { recommended: true } : {})
        }));
    const multiSelect = input.multiSelect === true && options.length > 1;
    // A single-choice question has at most one recommendation.
    if (!multiSelect) {
        let seen = false;
        for (const option of options) {
            if (option.recommended && seen) {
                delete option.recommended;
            }
            seen ||= Boolean(option.recommended);
        }
    }
    return {
        question,
        options,
        multiSelect,
        // Without options the only way to answer is free text.
        allowOther: input.allowOther !== false || options.length === 0
    };
}
