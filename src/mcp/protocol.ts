/** Messages between the MCP Servers section (webview) and the extension. Type-only: the webview imports it. */

export interface McpRow {
    name: string;
    scope: 'user' | 'project';
    /** "stdio", "http", "sse", or "invalid" for a server whose config could not be read. */
    type: string;
    status: 'connecting' | 'connected' | 'needs-auth' | 'error' | 'disabled';
    tools: number;
    error?: string;
    /** HTTP servers: Nova holds sign-in tokens for it. */
    signedIn?: boolean;
    /** The command line, or the address without its query. */
    target?: string;
}

export interface McpPageData {
    servers: McpRow[];
    hasProject: boolean;
    files: { user: string; project?: string };
}

export type McpCommand =
    | { command: 'mcp/ready' }
    | { command: 'mcp/signIn'; name: string }
    | { command: 'mcp/signOut'; name: string }
    | { command: 'mcp/reconnect'; name: string }
    | { command: 'mcp/setDisabled'; name: string; disabled: boolean }
    | { command: 'mcp/delete'; name: string; scope: 'user' | 'project' }
    | { command: 'mcp/add'; scope: 'user' | 'project' }
    | { command: 'mcp/openConfig'; scope: 'user' | 'project' };
