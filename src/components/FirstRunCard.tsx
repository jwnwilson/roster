import { useState } from 'react'
import { GhostButton, PrimaryButton } from '@/components/primitives'
import { dismissSetup, useRoster } from '@/state/store'

/**
 * What a brand-new install opens onto: one card above the grid, naming the
 * agent to start with.
 *
 * A card rather than a wizard. There is exactly one thing to decide — which
 * agent to talk to first — and a modal sequence to decide it would be in the
 * way of everyone who already knows. It sits above the roster it is talking
 * about, and it goes away for good the moment it is used or dismissed.
 */
export function FirstRunCard() {
  const setup = useRoster((s) => s.setup)
  const agents = useRoster((s) => s.agents)
  const openAgent = useRoster((s) => s.openAgent)
  const [error, setError] = useState<string | null>(null)

  if (!setup?.pending) return null

  // Resolved by id, so an agent renamed or deleted since it was seeded is
  // never named wrongly on the card.
  const starting = agents.find((agent) => agent.id === setup.startingAgentId) ?? null
  const others = setup.seededAgentIds
    .filter((id) => id !== starting?.id)
    .map((id) => agents.find((agent) => agent.id === id)?.name)
    .filter((name): name is string => name !== undefined)

  async function dismiss(): Promise<void> {
    setError(await dismissSetup())
  }

  function start(): void {
    if (!starting) return
    openAgent(starting.id)
    void dismiss()
  }

  return (
    <section className="mb-[18px] flex flex-col gap-[10px] rounded-card border border-accent-line bg-card px-[16px] py-[14px]">
      <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">Welcome to Roster</h2>

      {setup.noRunner ? (
        <p className="m-0 max-w-[620px] text-md leading-[1.55] text-muted">
          Roster runs the coding CLI you already have on your own account. Install Claude Code
          or Codex and sign in, then reopen Roster — it will set up a starter roster for you.
        </p>
      ) : (
        <p className="m-0 max-w-[620px] text-md leading-[1.55] text-muted">
          {starting ? (
            <>
              Start with <strong className="font-semibold text-ink">{starting.name}</strong>.
              Hand it the work; it breaks the work down and passes the pieces on.
            </>
          ) : (
            <>Your roster is set up. Open an agent to hand it some work.</>
          )}
          {others.length > 0 ? ` Also on the roster: ${others.join(', ')}.` : ''}
        </p>
      )}

      {error ? <p className="m-0 text-md text-error">{error}</p> : null}

      <div className="flex items-center gap-[10px]">
        {starting ? (
          <PrimaryButton onClick={start}>Start with {starting.name}</PrimaryButton>
        ) : null}
        <GhostButton onClick={() => void dismiss()}>Dismiss</GhostButton>
      </div>
    </section>
  )
}
