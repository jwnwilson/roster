import json

from domain.agents import Agent

from .ports import Parsed

# Tools whose use is a file write, so the thread records what the agent changed
# rather than only that it "used a tool".
_WRITE_TOOLS = frozenset({"Write", "Edit", "NotebookEdit", "MultiEdit"})


class ClaudeAdapter:
    """`claude -p … --output-format stream-json --verbose`.

    The shape below was read off the installed binary on 2026-08-10, not taken
    from documentation: an earlier draft of the spec invented a
    `{"kind","content"}` format that does not exist. See the mapping table in
    docs/specs/2026-08-10-subprocess-runtime.md §4.
    """

    name = "claude"

    def argv(self, agent: Agent, task: str, executable: str) -> list[str]:
        return [
            executable,
            "-p",
            task,
            "--output-format",
            "stream-json",
            "--verbose",
            "--model",
            agent.model,
        ]

    def summarise_argv(self, agent: Agent, executable: str) -> list[str]:
        # No --output-format: compaction wants the digest itself, not frames to
        # unwrap. The prompt arrives on stdin because a digest plus its journal
        # runs to kilobytes, which does not belong in an argument list.
        return [executable, "-p", "--model", agent.model]

    def parse(self, line: str) -> Parsed:
        stripped = line.strip()
        if not stripped:
            return []
        try:
            frame = json.loads(stripped)
        except json.JSONDecodeError:
            # Not ours to interpret. The runtime records it as an `event` rather
            # than dropping it — an agent printing a stack trace must not vanish.
            raise

        if not isinstance(frame, dict):
            raise ValueError("frame is not an object")

        kind = frame.get("type")

        if kind == "assistant":
            return self._from_assistant(frame)

        if kind == "result":
            if frame.get("is_error"):
                return [("event", str(frame.get("result") or "the agent reported an error"))]
            # Success is the turn ending, which the runtime already records.
            return []

        # system, hook_started, hook_response, rate_limit_event: recognised and
        # deliberately silent. Session chatter would bury the agent's own work.
        return []

    def _from_assistant(self, frame: dict) -> Parsed:
        """Every block, not just the first.

        One assistant message routinely carries several content blocks — a
        sentence of explanation followed by the edit it describes. Returning at
        the first match dropped everything after it, so a turn that said what it
        was about to do and then did it showed only the saying.
        """
        messages: Parsed = []
        blocks = frame.get("message", {}).get("content") or []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = (block.get("text") or "").strip()
                if text:
                    messages.append(("text", text))
            elif block.get("type") == "tool_use":
                name = block.get("name") or "a tool"
                path = (block.get("input") or {}).get("file_path")
                if name in _WRITE_TOOLS and path:
                    messages.append(("file_write", str(path)))
                else:
                    messages.append(("event", f"used {name}"))
        return messages
