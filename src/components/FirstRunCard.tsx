import { useEffect, useState, type ReactNode } from 'react'
import type { ProviderSummary } from '@shared/types'
import { SignInModal } from '@/components/SignInModal'
import { GhostButton, PrimaryButton } from '@/components/primitives'
import { dismissSetup, refreshSignInState, useRoster } from '@/state/store'

/** Account sign-ins offered straight on the card; the rest sit behind "Other". */
const CARD_PROVIDERS = 2

/**
 * What a brand-new install opens onto: one card above the grid.
 *
 * Three things it can ask, in order of what blocks the user:
 *  - the engine did not start, so nothing can run;
 *  - no model provider is signed in, so nothing can run yet — the card signs
 *    one in, whether this is a new install or an upgrade;
 *  - signed in and not yet started — name the agent to start with.
 *
 * A card rather than a wizard: each step is one decision.
 */
export function FirstRunCard() {
  const setup = useRoster((s) => s.setup)
  const agents = useRoster((s) => s.agents)
  const runners = useRoster((s) => s.runners)
  const openAgent = useRoster((s) => s.openAgent)
  const [error, setError] = useState<string | null>(null)
  const [later, setLater] = useState(false)
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [signIn, setSignIn] = useState<
    { open: false } | { open: true; initial?: { providerId: string; method: 'oauth' | 'api_key' } }
  >({ open: false })
  const [signedInAs, setSignedInAs] = useState<string | null>(null)

  const needsSignIn = setup?.needsSignIn === true

  useEffect(() => {
    if (!needsSignIn) return
    let live = true
    window.roster.signIn.providers().then(
      (list) => live && setProviders(list),
      () => live && setProviders([]),
    )
    return () => {
      live = false
    }
  }, [needsSignIn])

  if (!setup) return null

  const modal = signIn.open ? (
    <SignInModal
      providers={providers}
      {...(signIn.initial ? { initial: signIn.initial } : {})}
      onClose={() => setSignIn({ open: false })}
      onSignedIn={(name) => {
        setSignIn({ open: false })
        setSignedInAs(name)
        void refreshSignInState()
      }}
    />
  ) : null

  return (
    <>
      {setup.noRunner ? (
        setup.pending ? <EngineCard detail={runners.find((r) => r.id === 'pi')?.detail} /> : null
      ) : needsSignIn ? (
        later ? null : (
          <SignInCard
            providers={providers}
            onSignIn={(providerId, method) => setSignIn({ open: true, initial: { providerId, method } })}
            onOther={() => setSignIn({ open: true })}
            onLater={() => setLater(true)}
          />
        )
      ) : setup.pending ? (
        <StartCard
          startingId={setup.startingAgentId}
          startingName={agents.find((agent) => agent.id === setup.startingAgentId)?.name ?? null}
          otherNames={setup.seededAgentIds
            .filter((id) => id !== setup.startingAgentId)
            .map((id) => agents.find((agent) => agent.id === id)?.name)
            .filter((name): name is string => name !== undefined)}
          signedInAs={signedInAs}
          error={error}
          onStart={(id) => {
            openAgent(id)
            void dismissSetup().then(setError)
          }}
          onDismiss={() => void dismissSetup().then(setError)}
        />
      ) : null}
      {modal}
    </>
  )
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <section className="mb-[18px] flex flex-col gap-[10px] rounded-card border border-accent-line bg-card px-[16px] py-[14px]">
      {children}
    </section>
  )
}

function SignInCard({
  providers,
  onSignIn,
  onOther,
  onLater,
}: {
  providers: ProviderSummary[]
  onSignIn: (providerId: string, method: 'oauth' | 'api_key') => void
  onOther: () => void
  onLater: () => void
}) {
  const offered = providers.filter((p) => p.methods.some((m) => m.method === 'oauth')).slice(0, CARD_PROVIDERS)
  return (
    <CardShell>
      <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">Welcome to Roster</h2>
      <p className="m-0 max-w-[620px] text-md leading-[1.55] text-muted">
        Agents run on your own model account. Sign in to one provider to start. Roster keeps no
        password; the sign-in is stored by Pi on this Mac.
      </p>
      <div className="flex flex-wrap items-center gap-[10px]">
        {offered.map((provider, i) => (
          <PrimaryOrGhost key={provider.id} primary={i === 0} onClick={() => onSignIn(provider.id, 'oauth')}>
            Sign in with {provider.name}
          </PrimaryOrGhost>
        ))}
        <GhostButton onClick={onOther}>Other provider or API key…</GhostButton>
        <GhostButton onClick={onLater}>Later</GhostButton>
      </div>
    </CardShell>
  )
}

function PrimaryOrGhost({
  primary,
  onClick,
  children,
}: {
  primary: boolean
  onClick: () => void
  children: ReactNode
}) {
  return primary ? (
    <PrimaryButton onClick={onClick}>{children}</PrimaryButton>
  ) : (
    <GhostButton onClick={onClick}>{children}</GhostButton>
  )
}

function StartCard({
  startingId,
  startingName,
  otherNames,
  signedInAs,
  error,
  onStart,
  onDismiss,
}: {
  startingId: string | null
  startingName: string | null
  otherNames: string[]
  signedInAs: string | null
  error: string | null
  onStart: (agentId: string) => void
  onDismiss: () => void
}) {
  return (
    <CardShell>
      <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">Welcome to Roster</h2>
      <p className="m-0 max-w-[620px] text-md leading-[1.55] text-muted">
        {signedInAs ? <>Signed in to {signedInAs}. </> : null}
        {startingName ? (
          <>
            Start with <strong className="font-semibold text-ink">{startingName}</strong>. Hand it the
            work; it breaks the work down and passes the pieces on.
          </>
        ) : (
          <>Your roster is set up. Open an agent to hand it some work.</>
        )}
        {otherNames.length > 0 ? ` Also on the roster: ${otherNames.join(', ')}.` : ''}
      </p>
      {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      <div className="flex items-center gap-[10px]">
        {startingId && startingName ? (
          <PrimaryButton onClick={() => onStart(startingId)}>Start with {startingName}</PrimaryButton>
        ) : null}
        <GhostButton onClick={onDismiss}>Dismiss</GhostButton>
      </div>
    </CardShell>
  )
}

function EngineCard({ detail }: { detail: string | undefined }) {
  return (
    <CardShell>
      <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">Welcome to Roster</h2>
      <p className="m-0 max-w-[620px] text-md leading-[1.55] text-muted">
        Roster could not start its agent engine, so agents cannot run yet. Reopen Roster to try
        again.
      </p>
      {detail ? <p className="m-0 break-words font-mono text-md text-error">{detail}</p> : null}
      <div className="flex items-center gap-[10px]">
        <GhostButton onClick={() => void dismissSetup()}>Dismiss</GhostButton>
      </div>
    </CardShell>
  )
}
