import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Db } from '../db'
import type { NotionAuthStatus } from '../../../shared/notion'
import type { SecretBox } from './auth'

/** Path of the loopback redirect; the port is chosen per sign-in attempt. */
export const NOTION_MCP_CALLBACK_PATH = '/notion/mcp-oauth'
// The SDK treats a provider without a redirect as a non-interactive grant, so
// one is always reported. Outside an attempt it is never opened in a browser.
const IDLE_REDIRECT_URL = `http://127.0.0.1${NOTION_MCP_CALLBACK_PATH}`

interface StoredCredentials {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discovery?: OAuthDiscoveryState
  workspaceName?: string | null
}

interface Row {
  encrypted_payload: string
}

/**
 * Credential provider for Notion's hosted MCP OAuth flow.
 *
 * This deliberately implements the SDK provider rather than a Notion REST
 * token exchange: the same encrypted credential is used by the board adapter
 * and the local MCP proxy that agents connect to. No secret crosses IPC.
 */
export class NotionMcpAuth implements OAuthClientProvider {
  private expectedState: Buffer | null = null
  private attemptRedirectUrl: string | null = null
  private pendingAuthorizationUrl: URL | null = null
  private failure: string | null = null

  constructor(private readonly db: Db, private readonly box: SecretBox) {}

  get redirectUrl(): string {
    return this.attemptRedirectUrl ?? IDLE_REDIRECT_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Roster',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  status(): NotionAuthStatus {
    if (this.failure) return { state: 'error', message: this.failure }
    const stored = this.load()
    return stored.tokens?.access_token
      ? { state: 'connected', workspaceName: stored.workspaceName ?? null }
      : { state: 'disconnected' }
  }

  /** Starts a single-use OAuth attempt; the SDK supplies the actual URL. */
  startAttempt(redirectUrl: string): void {
    this.attemptRedirectUrl = redirectUrl
    this.failure = null
    this.pendingAuthorizationUrl = null
    this.expectedState = null
  }

  authorizationUrl(): string {
    if (!this.pendingAuthorizationUrl) throw new Error('Notion did not provide an authorization URL.')
    return this.pendingAuthorizationUrl.toString()
  }

  consumeCallback(callbackUrl: string): string {
    const callback = new URL(callbackUrl)
    const redirect = new URL(this.redirectUrl)
    if (!this.attemptRedirectUrl || callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) {
      throw new Error('That is not a Notion authorization response.')
    }
    const code = callback.searchParams.get('code')
    const state = callback.searchParams.get('state')
    const expected = this.expectedState
    this.expectedState = null
    if (!state || !expected) throw new Error('That Notion authorization response is invalid or has expired.')
    const received = Buffer.from(state, 'base64url')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new Error('That Notion authorization response did not match this sign-in attempt.')
    }
    // Only a response carrying this attempt's state may report a refusal.
    const declined = callback.searchParams.get('error_description') ?? callback.searchParams.get('error')
    if (declined) throw new Error(`Notion did not authorize Roster: ${declined}`)
    if (!code) throw new Error('That Notion authorization response is invalid or has expired.')
    return code
  }

  setWorkspaceName(workspaceName: string | null): void {
    const stored = this.load()
    this.save({ ...stored, workspaceName })
  }

  fail(cause: unknown): void {
    this.failure = cause instanceof Error ? cause.message : String(cause)
  }

  clear(): void {
    this.expectedState = null
    this.attemptRedirectUrl = null
    this.pendingAuthorizationUrl = null
    this.failure = null
    this.db.prepare('DELETE FROM notion_mcp_auth WHERE id = 1').run()
  }

  async state(): Promise<string> {
    const state = randomBytes(32)
    this.expectedState = state
    return state.toString('base64url')
  }

  /**
   * Each attempt listens on a fresh loopback port. A client registered for a
   * different redirect is withheld during the attempt so the SDK registers
   * again rather than sending a redirect_uri Notion would reject.
   */
  clientInformation(): OAuthClientInformationMixed | undefined {
    const information = this.load().clientInformation
    if (!information || !this.attemptRedirectUrl || !('redirect_uris' in information)) return information
    return information.redirect_uris.includes(this.attemptRedirectUrl) ? information : undefined
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.save({ ...this.load(), clientInformation })
  }

  tokens(): OAuthTokens | undefined {
    return this.load().tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ ...this.load(), tokens })
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.save({ ...this.load(), codeVerifier })
  }

  codeVerifier(): string {
    const verifier = this.load().codeVerifier
    if (!verifier) throw new Error('The Notion authorization attempt has expired. Start again.')
    return verifier
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    this.save({ ...this.load(), discovery })
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.load().discovery
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const stored = this.load()
    if (scope === 'all') return this.clear()
    if (scope === 'client') delete stored.clientInformation
    if (scope === 'tokens') delete stored.tokens
    if (scope === 'verifier') delete stored.codeVerifier
    if (scope === 'discovery') delete stored.discovery
    this.save(stored)
  }

  private load(): StoredCredentials {
    const row = this.db.prepare('SELECT encrypted_payload FROM notion_mcp_auth WHERE id = 1').get() as Row | undefined
    if (!row) return {}
    try {
      const parsed: unknown = JSON.parse(this.box.decrypt(row.encrypted_payload))
      return typeof parsed === 'object' && parsed !== null ? (parsed as StoredCredentials) : {}
    } catch {
      // Credentials are bound to this OS account. Treat unreadable data as disconnected.
      this.db.prepare('DELETE FROM notion_mcp_auth WHERE id = 1').run()
      return {}
    }
  }

  private save(value: StoredCredentials): void {
    this.db
      .prepare(
        `INSERT INTO notion_mcp_auth (id, encrypted_payload, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at`,
      )
      .run(this.box.encrypt(JSON.stringify(value)), Date.now())
  }
}
