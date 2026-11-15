import type { ProviderSummary } from '../../../../shared/types'
import { signInMethods, type ProviderAuthInfo } from './signIn'

/** What Pi says about a provider's ways in, as Roster reads it. */
interface PiProviderFacts {
  id: string
  name: string
  auth: {
    oauth?: { name: string }
    apiKey?: { name: string; login?: unknown }
  }
}

/** Pi's provider, reduced to the sign-in facts Roster uses. */
export function providerAuthInfo(provider: PiProviderFacts): ProviderAuthInfo {
  return {
    id: provider.id,
    name: provider.name,
    ...(provider.auth.oauth ? { oauth: provider.auth.oauth.name } : {}),
    ...(provider.auth.apiKey?.login ? { apiKey: provider.auth.apiKey.name } : {}),
  }
}

/**
 * The providers a person can sign in to, account sign-in first, then by name.
 * Providers with no way in Roster can drive are left out rather than offered
 * with a button that cannot work.
 */
export function summarizeProviders(
  providers: readonly ProviderAuthInfo[],
  signedIn: ReadonlySet<string>,
  isSubscription: (id: string) => boolean,
): ProviderSummary[] {
  return providers
    .map((info): ProviderSummary => {
      const methods = signInMethods(info)
      const on = signedIn.has(info.id)
      return {
        id: info.id,
        name: info.name,
        signedIn: on,
        subscription: on && isSubscription(info.id),
        methods,
      }
    })
    .filter((provider) => provider.methods.length > 0)
    .sort(
      (a, b) =>
        Number(b.methods.some((m) => m.method === 'oauth')) - Number(a.methods.some((m) => m.method === 'oauth')) ||
        a.name.localeCompare(b.name),
    )
}
