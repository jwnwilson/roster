/**
 * Recorded from a real `codex exec --json` run (Codex CLI 0.147.0)
 * executing a shell command. Ids and the thread id are kept verbatim.
 */

export const THREAD_STARTED = {
  "type": "thread.started",
  "thread_id": "01a0302c-17f1-7a41-9ae6-bd1f24f5abfa"
}

export const TURN_STARTED = {
  "type": "turn.started"
}

export const ITEM_AGENT_MESSAGE_1 = {
  "type": "item.completed",
  "item": {
    "id": "item_0",
    "type": "agent_message",
    "text": "Running the requested command."
  }
}

export const ITEM_COMMAND_STARTED = {
  "type": "item.started",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "/bin/zsh -lc 'echo codex-tool-ok'",
    "aggregated_output": "",
    "exit_code": null,
    "status": "in_progress"
  }
}

export const ITEM_COMMAND_COMPLETED = {
  "type": "item.completed",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "/bin/zsh -lc 'echo codex-tool-ok'",
    "aggregated_output": "codex-tool-ok\n",
    "exit_code": 0,
    "status": "completed"
  }
}

export const ITEM_AGENT_MESSAGE_2 = {
  "type": "item.completed",
  "item": {
    "id": "item_2",
    "type": "agent_message",
    "text": "codex-tool-ok"
  }
}

export const TURN_COMPLETED = {
  "type": "turn.completed",
  "usage": {
    "input_tokens": 29223,
    "cached_input_tokens": 24064,
    "cache_write_input_tokens": 0,
    "output_tokens": 121,
    "reasoning_output_tokens": 0
  }
}

export const TURN_FAILED = {
  type: 'turn.failed',
  error: { message: 'model refused the request' },
}

/** The full recorded turn, in order. */
export const FULL_TURN = [
  THREAD_STARTED,
  TURN_STARTED,
  ITEM_AGENT_MESSAGE_1,
  ITEM_COMMAND_STARTED,
  ITEM_COMMAND_COMPLETED,
  ITEM_AGENT_MESSAGE_2,
  TURN_COMPLETED,
]
