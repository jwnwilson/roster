"""The app with a deliberately slow commit, for the ordering test beside it.

A test module rather than a production hook: the question "does the response
outrun the commit?" cannot be asked without making the commit slow enough to
observe, and roster's own code should not carry a switch for that.
"""

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

_real_commit = AsyncSession.commit
COMMIT_DELAY_SECONDS = 1.0


async def _slow_commit(self: AsyncSession) -> None:
    await asyncio.sleep(COMMIT_DELAY_SECONDS)
    await _real_commit(self)


AsyncSession.commit = _slow_commit  # type: ignore[method-assign]

from interactors.api.app import create_app  # noqa: E402


def app():
    return create_app()
