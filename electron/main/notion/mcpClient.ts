import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { CallToolResultSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { NotionMcpAuth } from './mcpAuth'

export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'

/** The narrow MCP surface both the board adapter and agent proxy need. */
export interface NotionMcpTools {
  tools(): Promise<Tool[]>
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>
}

/**
 * One authenticated hosted-MCP client for the application.
 *
 * Runner processes never see this transport or its OAuth provider. They use
 * a local stdio proxy that delegates calls to this object.
 */
export class NotionMcpClient implements NotionMcpTools {
  private client: Client | null = null
  private transport: StreamableHTTPClientTransport | null = null

  constructor(private readonly auth: NotionMcpAuth) {}

  async beginAuthorization(): Promise<string> {
    this.close()
    this.auth.startAttempt()
    try {
      await this.connect()
    } catch (cause) {
      if (!(cause instanceof UnauthorizedError)) {
        this.auth.fail(cause)
        throw cause
      }
    }
    return this.auth.authorizationUrl()
  }

  async completeAuthorization(callbackUrl: string): Promise<void> {
    const code = this.auth.consumeCallback(callbackUrl)
    const transport = this.transport
    if (!transport) throw new Error('The Notion authorization attempt has expired. Start again.')
    try {
      await transport.finishAuth(code)
      await this.connect(true)
      await this.identifyWorkspace()
    } catch (cause) {
      this.auth.fail(cause)
      throw cause
    }
  }

  async tools(): Promise<Tool[]> {
    const client = await this.ready()
    const result = await client.listTools()
    return result.tools
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.ready()
    return client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
  }

  close(): void {
    const transport = this.transport
    this.client = null
    this.transport = null
    if (transport) void transport.close().catch(() => undefined)
  }

  private async ready(): Promise<Client> {
    if (!this.client) await this.connect()
    if (!this.client) throw new Error('Connect Notion before using it.')
    return this.client
  }

  private async connect(replace = false): Promise<void> {
    if (replace) this.close()
    if (this.client) return
    const transport = new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), { authProvider: this.auth })
    const client = new Client({ name: 'Roster', version: '1.0.0' }, { capabilities: {} })
    this.transport = transport
    try {
      await client.connect(transport)
      this.client = client
    } catch (cause) {
      // Keep the transport after UnauthorizedError: finishAuth must exchange
      // the code on the same provider/PKCE attempt.
      if (!(cause instanceof UnauthorizedError)) this.close()
      throw cause
    }
  }

  private async identifyWorkspace(): Promise<void> {
    const reply = await this.call('notion-fetch', { id: 'self' })
    const workspaceName = workspaceNameFrom(reply)
    this.auth.setWorkspaceName(workspaceName)
  }
}

function workspaceNameFrom(reply: CallToolResult): string | null {
  const structured = reply.structuredContent
  if (structured && typeof structured === 'object') {
    const self = (structured as Record<string, unknown>)['self']
    if (self && typeof self === 'object') {
      const name = (self as Record<string, unknown>)['workspace_name'] ?? (self as Record<string, unknown>)['name']
      if (typeof name === 'string') return name
    }
  }
  return null
}
