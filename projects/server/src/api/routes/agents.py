from fastapi import APIRouter, Depends

from adapters.agents.folder import read_agents
from api.envelope import ok_list
from config.settings import Settings, agents_dir, get_settings

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
async def list_agents(settings: Settings = Depends(get_settings)) -> dict:
    agents = read_agents(agents_dir(settings))
    return ok_list([agent.model_dump(mode="json") for agent in agents], len(agents), 50, 1)
