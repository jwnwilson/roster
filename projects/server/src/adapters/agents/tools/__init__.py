from domain.agents import AgentTool

from .antigravity_tool import AntigravityAdapter
from .claude_tool import ClaudeAdapter
from .codex_tool import CodexAdapter
from .ports import Parsed, ToolAdapter

ADAPTERS: dict[AgentTool, ToolAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "antigravity": AntigravityAdapter(),
}

__all__ = [
    "ADAPTERS",
    "AntigravityAdapter",
    "ClaudeAdapter",
    "CodexAdapter",
    "Parsed",
    "ToolAdapter",
]
