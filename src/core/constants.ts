export const EXTENSION_ID = 'datalabrotterdam.nova-ai-vscode';
export const NOVA_VENDOR = 'nova-ai';
export const NOVA_VIEW_CONTAINER_ID = 'nova';
export const NOVA_SIDEBAR_VIEW_ID = 'nova.sidebar';

export const COMMAND_MANAGE = 'nova.manage';
export const COMMAND_SIGN_IN = 'nova.signIn';
export const COMMAND_SIGN_OUT = 'nova.signOut';
export const COMMAND_REFRESH_MODELS = 'nova.refreshModels';
export const COMMAND_OPEN_CHAT = 'nova.openChat';
export const COMMAND_OPEN_SETTINGS = 'nova.openSettings';
export const COMMAND_MANAGE_MODELS = 'nova.manageModels';
export const COMMAND_NEW_CHAT = 'nova.newChat';
export const COMMAND_ADD_SELECTION = 'nova.addSelectionToChat';
export const COMMAND_FOCUS_CHAT = 'nova.focusChat';
export const COMMAND_OPEN_CHAT_IN_EDITOR = 'nova.openChatInEditor';
export const COMMAND_OPEN_GLOBAL_MEMORY = 'nova.openGlobalMemory';
export const COMMAND_OPEN_PROJECT_MEMORY = 'nova.openProjectMemory';
export const COMMAND_REVEAL_HOME = 'nova.revealHome';
export const COMMAND_CLEAN_UP_PROJECTS = 'nova.cleanUpProjects';
export const COMMAND_SHOW_HISTORY = 'nova.showHistory';
export const COMMAND_SEARCH_CHATS = 'nova.chats.search';
export const COMMAND_MANAGE_SKILLS = 'nova.manageSkills';
export const COMMAND_SHOW_HELP = 'nova.showHelp';
/** Context menu of a row on the Chats page. */
export const COMMAND_CHAT_OPEN_IN_EDITOR = 'nova.chats.openInEditor';
export const COMMAND_CHAT_RENAME = 'nova.chats.rename';
export const COMMAND_CHAT_DELETE = 'nova.chats.delete';
export const COMMAND_SHOW_ACCOUNT = 'nova.showAccount';
export const CONTEXT_SIGNED_IN = 'nova.signedIn';

export const SECRET_API_KEY = 'nova.apiKey';
export const STATE_ACCOUNT_SUMMARY = 'nova.accountSummary';
export const STATE_CONNECTION_HEALTH = 'nova.connectionHealth';
export const STATE_LAST_ERROR = 'nova.lastError';
export const STATE_SELECTED_MODEL = 'nova.selectedModel';
export const STATE_MODEL_TOOL_SUPPORT = 'nova.modelToolSupport';

export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

export const NOVA_USAGE_MIME_TYPE = 'application/vnd.nova-ai.usage+json';
export const NOVA_THINKING_MIME_TYPE = 'application/vnd.nova-ai.thinking';
