from fastapi import APIRouter, Depends

from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, get_settings
from domain.agents import mark_working, read_agents
from interactors.api.deps import get_file_store, get_turn_manager
from interactors.api.envelope import ok_list
from interactors.turns.manager import AgentTurnManager

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
async def list_agents(
    settings: Settings = Depends(get_settings),
    store: FileStore = Depends(get_file_store),
    manager: AgentTurnManager = Depends(get_turn_manager),
) -> dict:
    # Spec §3: an in-flight turn is the only source of Working. The folder on disk
    # can only say active or disabled — it knows nothing about what is running.
    agents = mark_working(read_agents(agents_dir(settings), store), set(manager.busy_agents()))
    return ok_list([agent.model_dump(mode="json") for agent in agents], len(agents), 50, 1)
