import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
}

/**
 * Task descriptions and comments, rendered.
 *
 * Raw HTML stays off — no `rehype-raw` — because agents write this text as
 * well as people, and a task body is not a place to be executing markup that
 * arrived from a model.
 */
export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="flex flex-col gap-[10px] text-2xl leading-[1.62] text-ink-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: body }) => (
            <h1 className="m-0 mt-[6px] text-3xl font-semibold text-ink">{body}</h1>
          ),
          h2: ({ children: body }) => (
            <h2 className="m-0 mt-[6px] text-2xl font-semibold text-ink">{body}</h2>
          ),
          h3: ({ children: body }) => (
            <h3 className="m-0 mt-[4px] text-xl font-semibold text-ink">{body}</h3>
          ),
          p: ({ children: body }) => <p className="m-0">{body}</p>,
          ul: ({ children: body }) => (
            <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px]">{body}</ul>
          ),
          ol: ({ children: body }) => (
            <ol className="m-0 flex list-decimal flex-col gap-[4px] pl-[20px]">{body}</ol>
          ),
          li: ({ children: body }) => <li className="m-0">{body}</li>,
          strong: ({ children: body }) => (
            <strong className="font-bold text-ink">{body}</strong>
          ),
          blockquote: ({ children: body }) => (
            <blockquote className="m-0 border-l-2 border-accent-line pl-[12px] text-muted-2">
              {body}
            </blockquote>
          ),
          a: ({ children: body, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent-light">
              {body}
            </a>
          ),
          code: ({ children: body, className }) => {
            // react-markdown gives a fenced block a language class and an
            // inline span none, which is the only way to tell them apart.
            const fenced = typeof className === 'string' && className.includes('language-')
            if (fenced) return <code className="font-mono text-lg">{body}</code>

            return (
              <code className="rounded-[3px] bg-[#1a1c23] px-[5px] py-[1px] font-mono text-lg text-accent-text">
                {body}
              </code>
            )
          },
          pre: ({ children: body }) => (
            <pre className="m-0 overflow-x-auto rounded-chip bg-well p-[12px] font-mono text-lg leading-[1.6] text-ink-2">
              {body}
            </pre>
          ),
          hr: () => <hr className="m-0 border-0 border-t border-line" />,
          table: ({ children: body }) => (
            <div className="overflow-x-auto">
              <table className="border-collapse text-lg">{body}</table>
            </div>
          ),
          th: ({ children: body }) => (
            <th className="border border-line px-[9px] py-[5px] text-left font-semibold text-ink">
              {body}
            </th>
          ),
          td: ({ children: body }) => (
            <td className="border border-line px-[9px] py-[5px]">{body}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
