import { useEffect, useState } from 'react'
import { useRoster } from '@/state/store'
import { splitSnippet } from '@shared/search'
import type { SessionSearchHit } from '@shared/types'

/** How long to wait after the last keystroke before asking the main process. */
const SEARCH_DEBOUNCE_MS = 200

interface TranscriptMatchesProps {
  query: string
  includeArchived: boolean
}

/**
 * Sessions whose transcript matches the search box, under the names that
 * already match there.
 *
 * Separate from the synchronous name match on the rail: a name is in memory,
 * a transcript is in SQLite, so this asks the main process and only after the
 * typing has paused. A late answer for a query that has since changed is
 * dropped rather than shown.
 */
export function TranscriptMatches({ query, includeArchived }: TranscriptMatchesProps) {
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed === '') {
      setHits([])
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      void window.roster.sessions.search(trimmed, { includeArchived }).then((found) => {
        if (!cancelled) setHits(found)
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, includeArchived])

  if (trimmed === '') return null

  return (
    <div className="flex flex-col gap-[1px] pb-[6px]">
      <div className="flex items-center px-[16px] pt-[4px] pb-[4px]">
        <span className="text-xs font-semibold uppercase tracking-[0.07em] text-label">
          Matching transcripts
        </span>
        <span className="ml-auto font-mono text-xs text-faint-2">{hits.length}</span>
      </div>

      {hits.length === 0 ? (
        <p className="m-0 px-[16px] py-[4px] text-sm text-dim-2">No transcripts match.</p>
      ) : (
        hits.map((hit) => <TranscriptHitRow key={hit.sessionId} hit={hit} />)
      )}
    </div>
  )
}

function TranscriptHitRow({ hit }: { hit: SessionSearchHit }) {
  const agentName = useRoster((s) => s.agents.find((agent) => agent.id === hit.agentId)?.name ?? 'Unknown agent')
  const openAgent = useRoster((s) => s.openAgent)
  const go = useRoster((s) => s.go)

  // Archived sessions are not listed under their agent, so the match takes
  // you to where they are kept rather than to a tab that does not exist.
  const open = () => (hit.archived ? go('archived') : openAgent(hit.agentId, hit.sessionId))

  return (
    <button
      type="button"
      onClick={open}
      title={`${hit.label} — ${hit.matches} match${hit.matches === 1 ? '' : 'es'}`}
      className="flex cursor-pointer flex-col gap-[2px] rounded-chip border-0 bg-transparent px-[16px] py-[5px] text-left font-ui hover:bg-[#1a1c23]"
    >
      <span className="flex min-w-0 items-center gap-[6px] text-lg text-muted-2">
        <span className="truncate">{hit.label}</span>
        <span className="flex-none text-xs text-faint-2">{agentName}</span>
        {hit.archived ? <span className="flex-none text-xs text-faint">archived</span> : null}
      </span>
      <span className="line-clamp-2 text-sm text-dim">
        {splitSnippet(hit.snippet).map((part, index) =>
          part.matched ? (
            <mark key={index} className="rounded-[2px] bg-accent-surface-2 text-ink">
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
    </button>
  )
}
