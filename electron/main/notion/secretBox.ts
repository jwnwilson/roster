/**
 * How a Notion credential is kept at rest.
 *
 * An interface rather than a call to Electron's safeStorage, so the credential
 * store can be tested without an Electron runtime — and so there is exactly
 * one place that decides what encryption a Roster install uses.
 */
export interface SecretBox {
  encrypt(value: string): string
  decrypt(value: string): string
}
