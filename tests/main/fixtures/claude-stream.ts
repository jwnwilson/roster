/**
 * Recorded from a real `claude -p --output-format stream-json` run
 * (Claude Code 2.1.241) reading a file and reporting its contents.
 * Trimmed to the fields the normalizer reads; ids and paths are stable
 * placeholders so assertions can name them.
 */

export const SYSTEM_INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-abc',
  tools: ['Read', 'Bash'],
}

export const THINKING_ONLY = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: 'The user wants the file contents.' }],
  },
  session_id: 'sess-abc',
}

export const TOOL_USE = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_016Mdj',
        name: 'Read',
        input: { file_path: '/work/api/note.txt' },
        caller: { type: 'direct' },
      },
    ],
  },
  session_id: 'sess-abc',
}

export const TOOL_RESULT = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        tool_use_id: 'toolu_016Mdj',
        type: 'tool_result',
        content: '1\thello from roster fixture\n2\t',
      },
    ],
  },
  session_id: 'sess-abc',
}

export const TOOL_RESULT_ERROR = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        tool_use_id: 'toolu_016Mdj',
        type: 'tool_result',
        is_error: true,
        content: [{ type: 'text', text: 'ENOENT: no such file' }],
      },
    ],
  },
  session_id: 'sess-abc',
}

export const ASSISTANT_TEXT = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello from roster fixture' }],
  },
  session_id: 'sess-abc',
}

export const RATE_LIMIT_EVENT = { type: 'rate_limit_event', session_id: 'sess-abc' }

export const RESULT_SUCCESS = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 2,
  result: 'hello from roster fixture',
  session_id: 'sess-abc',
  total_cost_usd: 0.0484788,
  usage: {
    input_tokens: 18,
    cache_creation_input_tokens: 20_640,
    cache_read_input_tokens: 56_958,
    output_tokens: 297,
  },
}

export const RESULT_ERROR = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  num_turns: 1,
  result: 'the model refused the request',
  session_id: 'sess-abc',
  total_cost_usd: 0.002,
  usage: { input_tokens: 10, output_tokens: 0 },
}

/** The full recorded turn, in order. */
export const FULL_TURN = [
  SYSTEM_INIT,
  THINKING_ONLY,
  TOOL_USE,
  RATE_LIMIT_EVENT,
  TOOL_RESULT,
  ASSISTANT_TEXT,
  RESULT_SUCCESS,
]
