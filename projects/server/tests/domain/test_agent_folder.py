import os

import pytest

from adapters.storage.local import LocalFileStore
from adapters.storage.memory import InMemoryFileStore
from domain.agents import (
    Agent,
    UnknownAgent,
    agent_folder,
    create_agent_folder,
    mark_working,
    read_agent,
    read_agents,
)


def _write_agent(root, name, config="model: claude-opus-5\ntoken_limit: 200000\n"):
    folder = root / name
    (folder / "skills" / "research").mkdir(parents=True)
    (folder / "AGENT.md").write_text(f"# {name}\nYou are {name}.")
    (folder / "config.yaml").write_text(config)
    return folder


@pytest.fixture
def store(tmp_path):
    return LocalFileStore(tmp_path)


def test_an_agent_name_resolves_to_a_folder_directly_under_the_agents_root(tmp_path):
    assert agent_folder(tmp_path, "atlas") == tmp_path / "atlas"


@pytest.mark.parametrize("name", ["../../etc", "atlas/../../etc", "/etc", "", ".", "..", "a/b"])
def test_an_agent_name_that_is_not_one_path_segment_is_not_an_agent(tmp_path, name):
    # An agent is a folder directly under the agents root (spec §4). Anything else
    # is not an agent this roster has — silently truncating "../../etc" to "etc"
    # produced a run recorded against an agent that never existed.
    with pytest.raises(UnknownAgent):
        agent_folder(tmp_path, name)


def test_creating_an_agent_folder_produces_one_the_reader_accepts(tmp_path):
    # Arrange — the shape of an agent folder is a roster rule, so writing one is
    # reachable from domain alone, against any store.
    memory_store = InMemoryFileStore(tmp_path)

    # Act
    folder = create_agent_folder(
        tmp_path / "atlas",
        memory_store,
        instructions="# atlas\nYou are atlas.",
        config={"model": "claude-opus-5", "token_limit": 1234},
    )

    # Assert
    agent = read_agent(folder, memory_store)
    assert agent.status == "active"
    assert agent.model == "claude-opus-5"
    assert agent.token_limit == 1234
    assert memory_store.is_dir(folder / "skills")


def test_reads_name_model_and_skills_from_disk(tmp_path, store):
    # Arrange
    _write_agent(tmp_path, "atlas")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert len(agents) == 1
    assert agents[0].name == "atlas"
    assert agents[0].model == "claude-opus-5"
    assert agents[0].skills == ["research"]
    assert agents[0].status == "active"


def test_malformed_config_yields_a_disabled_agent_with_a_reason(tmp_path, store):
    # Arrange
    _write_agent(tmp_path, "beacon", config="model: [unclosed\n")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert agents[0].status == "disabled"
    assert agents[0].problem is not None


def test_missing_agent_md_yields_a_disabled_agent(tmp_path, store):
    # Arrange
    folder = _write_agent(tmp_path, "cinder")
    (folder / "AGENT.md").unlink()

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert agents[0].status == "disabled"
    assert "AGENT.md" in agents[0].problem


def test_missing_agents_root_is_not_an_error(tmp_path, store):
    assert read_agents(tmp_path / "absent", store) == []


def test_agents_are_sorted_by_name(tmp_path, store):
    # Arrange
    _write_agent(tmp_path, "forge")
    _write_agent(tmp_path, "atlas")

    # Act / Assert
    assert [agent.name for agent in read_agents(tmp_path, store)] == ["atlas", "forge"]


def test_non_numeric_token_limit_yields_disabled_agent(tmp_path, store):
    # Arrange
    _write_agent(tmp_path, "broken", config="model: claude-opus-5\ntoken_limit: not-a-number\n")
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "token_limit" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


def test_non_numeric_temperature_yields_disabled_agent(tmp_path, store):
    # Arrange
    _write_agent(
        tmp_path, "broken", config="model: claude-opus-5\ntemperature: hot\n"
    )
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert broken.problem is not None
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses file permissions")
def test_unreadable_agent_md_yields_disabled_agent(tmp_path, store):
    # Arrange
    folder = _write_agent(tmp_path, "broken")
    agent_file = folder / "AGENT.md"
    agent_file.chmod(0o000)
    _write_agent(tmp_path, "good")

    # Act
    try:
        agents = read_agents(tmp_path, store)

        # Assert
        assert len(agents) == 2
        broken = next(a for a in agents if a.name == "broken")
        assert broken.status == "disabled"
        assert broken.problem is not None
        good = next(a for a in agents if a.name == "good")
        assert good.status == "active"
    finally:
        # Restore permissions so tmpdir cleanup doesn't fail
        agent_file.chmod(0o644)


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses file permissions")
def test_unreadable_config_yaml_yields_disabled_agent(tmp_path, store):
    # Arrange
    folder = _write_agent(tmp_path, "broken")
    config_file = folder / "config.yaml"
    config_file.chmod(0o000)
    _write_agent(tmp_path, "good")

    # Act
    try:
        agents = read_agents(tmp_path, store)

        # Assert
        assert len(agents) == 2
        broken = next(a for a in agents if a.name == "broken")
        assert broken.status == "disabled"
        assert broken.problem is not None
        good = next(a for a in agents if a.name == "good")
        assert good.status == "active"
    finally:
        # Restore permissions so tmpdir cleanup doesn't fail
        config_file.chmod(0o644)


def test_skills_as_file_yields_disabled_agent(tmp_path, store):
    # Arrange
    import shutil

    folder = _write_agent(tmp_path, "broken")
    shutil.rmtree(folder / "skills")  # Remove the directory
    (folder / "skills").write_text("I am a file")  # Create a file instead
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "skills" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


def test_non_scalar_model_yields_disabled_agent(tmp_path, store):
    # Arrange
    _write_agent(tmp_path, "broken", config="model: [opus, sonnet]\n")
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path, store)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "model" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


def test_an_agent_taking_a_turn_is_marked_working():
    agents = [Agent(name="atlas", status="active"), Agent(name="beacon", status="active")]

    marked = mark_working(agents, {"atlas"})

    assert [(a.name, a.status) for a in marked] == [("atlas", "working"), ("beacon", "active")]


def test_a_disabled_agent_is_never_marked_working():
    # A broken folder cannot be taking a turn; hiding the reason behind a healthy
    # status would waste the whole disabled-with-reason mechanism.
    agents = [Agent(name="cinder", status="disabled", problem="AGENT.md is missing")]

    marked = mark_working(agents, {"cinder"})

    assert marked[0].status == "disabled"
    assert marked[0].problem == "AGENT.md is missing"


def test_marking_leaves_the_originals_untouched():
    agents = [Agent(name="atlas", status="active")]

    mark_working(agents, {"atlas"})

    assert agents[0].status == "active"


def test_the_tool_is_inferred_from_the_model_when_config_omits_it(tmp_path):
    # Existing agent folders have no `tool` key and must keep working.
    for model, expected in [
        ("claude-opus-5", "claude"),
        ("gpt-5-codex", "codex"),
        ("o3-mini", "codex"),
        ("gemini-2.5-pro", "gemini"),
    ]:
        root = tmp_path / model
        root.mkdir()
        _write_agent(root, "atlas", config=f"model: {model}\n")
        agent = read_agent(root / "atlas", LocalFileStore(root))
        assert agent.tool == expected, model


def test_an_explicit_tool_beats_the_inference(tmp_path):
    _write_agent(tmp_path, "atlas", config="model: claude-opus-5\ntool: codex\n")

    agent = read_agent(tmp_path / "atlas", LocalFileStore(tmp_path))

    assert agent.tool == "codex"


def test_an_unknown_tool_disables_the_agent_rather_than_becoming_an_exec(tmp_path):
    # A folder that could name an arbitrary command would let a malformed
    # config.yaml execute anything. An unrecognised name is a Disabled agent.
    _write_agent(tmp_path, "atlas", config="model: claude-opus-5\ntool: rm -rf /\n")

    agent = read_agent(tmp_path / "atlas", LocalFileStore(tmp_path))

    assert agent.status == "disabled"
    assert "tool must be one of" in (agent.problem or "")


def test_a_model_the_operator_never_chose_is_not_invented(tmp_path, store):
    """`model` reported nothing when config.yaml says nothing.

    It used to fall back to roster's default, which is a *claude* model. An agent
    with `tool: codex` and no `model:` therefore reported `claude-opus-5` — a
    vendor it does not use, from a file that does not say it. The Agents screen
    printed that under a column headed "MODEL · config.yaml".
    """
    _write_agent(tmp_path, "scout", config="tool: codex\n")

    agent = read_agent(tmp_path / "scout", store)

    assert agent.model is None
    assert agent.tool == "codex"


def test_a_model_the_operator_did_choose_is_reported_verbatim(tmp_path, store):
    _write_agent(tmp_path, "atlas", config="model: claude-opus-5\n")

    assert read_agent(tmp_path / "atlas", store).model == "claude-opus-5"


def test_an_agent_with_no_config_at_all_still_defaults_to_claude(tmp_path, store):
    # The tool cannot be inferred from a model that was never named, and claude
    # is the tool roster shipped first. This keeps every existing agent folder
    # working untouched.
    _write_agent(tmp_path, "plain", config="")

    agent = read_agent(tmp_path / "plain", store)

    assert agent.tool == "claude"
    assert agent.model is None
