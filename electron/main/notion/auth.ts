import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db'
import type { NotionAuthStatus } from '../../../shared/notion'

const TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize'
const PENDING_FOR_MS = 10 * 60 * 1_000

export interface SecretBox {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface NotionOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

interface Credentials {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
}

interface AuthRow {
  encrypted_payload: string
  workspace_name: string | null
}

interface TokenReply {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  workspace_name?: unknown
}

/**
 * Owns Notion's public OAuth credential. Its database row is deliberately
 * opaque: safeStorage encrypts before persistence and credentials never cross
 * IPC. The public connection's client credentials are deployment environment,
 * not a user-editable MCP server setting.
 */
export class NotionAuth {
  private pending: { state: Buffer; expiresAt: number } | null = null
  private failure: string | null = null

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly config: NotionOAuthConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  status(): NotionAuthStatus {
    if (!this.config) {
      return {
        state: 'needs_configuration',
        message: 'Notion OAuth is not configured for this build.',
      }
    }
    const row = this.row()
    if (this.failure) return { state: 'error', message: this.failure }
    return row ? { state: 'connected', workspaceName: row.workspace_name } : { state: 'disconnected' }
  }

  begin(): string {
    const config = this.requireConfig()
    this.failure = null
    const state = randomBytes(32)
    this.pending = { state, expiresAt: this.now() + PENDING_FOR_MS }
    const query = new URLSearchParams({
      owner: 'user',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      state: state.toString('base64url'),
    })
    return `${AUTHORIZE_URL}?${query}`
  }

  /** Completes a callback URL received through Roster's registered protocol. */
  async complete(callbackUrl: string): Promise<void> {
    try {
      const callback = new URL(callbackUrl)
      const code = callback.searchParams.get('code')
      const state = callback.searchParams.get('state')
      const pending = this.pending
      this.pending = null // callbacks are single-use, including failures

      if (!code || !state || !pending || pending.expiresAt < this.now()) {
        throw new Error('That Notion authorization response has expired or is invalid. Start again.')
      }
      const received = Buffer.from(state, 'base64url')
      if (received.length !== pending.state.length || !timingSafeEqual(received, pending.state)) {
        throw new Error('That Notion authorization response did not match this sign-in attempt.')
      }

      const reply = await this.token({ grant_type: 'authorization_code', code })
      this.save(reply)
    } catch (cause) {
      this.failure = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async accessToken(): Promise<string> {
    const credentials = this.credentials()
    if (credentials.expiresAt !== null && credentials.expiresAt <= this.now() + 60_000) {
      return this.refresh()
    }
    return credentials.accessToken
  }

  /** Called once by NotionClient after a 401, then the original request retries. */
  async refresh(): Promise<string> {
    const credentials = this.credentials()
    if (!credentials.refreshToken) throw new Error('Notion access was revoked. Connect Notion again.')
    const reply = await this.token({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken })
    this.save(reply, credentials)
    return this.credentials().accessToken
  }

  clear(): void {
    this.pending = null
    this.failure = null
    this.db.prepare('DELETE FROM notion_auth WHERE id = 1').run()
  }

  private async token(body: Record<string, string>): Promise<TokenReply> {
    const config = this.requireConfig()
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...body, redirect_uri: config.redirectUri }),
    })
    const reply = (await response.json()) as TokenReply
    if (!response.ok || typeof reply.access_token !== 'string') {
      throw new Error('Notion could not complete authorization. Please try connecting again.')
    }
    return reply
  }

  private save(reply: TokenReply, previous?: Credentials): void {
    if (typeof reply.access_token !== 'string') throw new Error('Notion did not return an access token.')
    const expiresIn = typeof reply.expires_in === 'number' ? reply.expires_in : null
    const credentials: Credentials = {
      accessToken: reply.access_token,
      refreshToken: typeof reply.refresh_token === 'string' ? reply.refresh_token : previous?.refreshToken ?? null,
      expiresAt: expiresIn === null ? null : this.now() + expiresIn * 1_000,
    }
    const workspaceName = typeof reply.workspace_name === 'string' ? reply.workspace_name : this.row()?.workspace_name ?? null
    this.db
      .prepare(
        `INSERT INTO notion_auth (id, encrypted_payload, workspace_name, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload,
           workspace_name = excluded.workspace_name, updated_at = excluded.updated_at`,
      )
      .run(this.box.encrypt(JSON.stringify(credentials)), workspaceName, this.now())
  }

  private credentials(): Credentials {
    const row = this.row()
    if (!row) throw new Error('Connect Notion before importing tasks.')
    try {
      const value: unknown = JSON.parse(this.box.decrypt(row.encrypted_payload))
      if (isCredentials(value)) return value
    } catch {
      // A credential encrypted by another OS account is intentionally unusable.
    }
    this.clear()
    throw new Error('Notion authorization is unavailable. Connect Notion again.')
  }

  private row(): AuthRow | null {
    return (this.db.prepare('SELECT encrypted_payload, workspace_name FROM notion_auth WHERE id = 1').get() as AuthRow | undefined) ?? null
  }

  private requireConfig(): NotionOAuthConfig {
    if (!this.config) throw new Error('Notion OAuth is not configured for this build.')
    return this.config
  }
}

function isCredentials(value: unknown): value is Credentials {
  return typeof value === 'object' && value !== null && typeof (value as Credentials).accessToken === 'string'
}
