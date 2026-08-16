from domain.agents import AgentTool

from .claude_tool import ClaudeAdapter
from .codex_tool import CodexAdapter
from .ports import Parsed, ToolAdapter

# antigravity is deliberately absent: its binary (`ayg`) is not installed here,
# so its real output has never been seen, and writing an adapter from a guessed
# format is the exact mistake the claude one had to correct. An agent naming an
# unavailable tool already disables itself with a readable reason, so shipping
# two adapters is a coherent state rather than a half-built one.
ADAPTERS: dict[AgentTool, ToolAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
}

__all__ = ["ADAPTERS", "ClaudeAdapter", "CodexAdapter", "Parsed", "ToolAdapter"]
