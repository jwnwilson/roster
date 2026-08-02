from fastapi import APIRouter, Depends

from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, get_settings
from domain.agents import read_agents
from interactors.api.deps import get_file_store
from interactors.api.envelope import ok_list

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
async def list_agents(
    settings: Settings = Depends(get_settings),
    store: FileStore = Depends(get_file_store),
) -> dict:
    agents = read_agents(agents_dir(settings), store)
    return ok_list([agent.model_dump(mode="json") for agent in agents], len(agents), 50, 1)
