from domain.agents import AgentTool

from .claude_tool import ClaudeAdapter
from .ports import Parsed, ToolAdapter

# codex and gemini are deliberately absent: neither binary was available to probe
# on 2026-08-10, and writing an adapter from a guessed output format is the exact
# mistake the claude one had to correct. An agent naming an unavailable tool
# already disables itself with a readable reason, so shipping one adapter is a
# coherent state rather than a half-built one.
ADAPTERS: dict[AgentTool, ToolAdapter] = {
    "claude": ClaudeAdapter(),
}

__all__ = ["ADAPTERS", "ClaudeAdapter", "Parsed", "ToolAdapter"]
