import os

import pytest

from adapters.agents.folder import read_agents


def _write_agent(root, name, config="model: claude-opus-5\ntoken_limit: 200000\n"):
    folder = root / name
    (folder / "skills" / "research").mkdir(parents=True)
    (folder / "AGENT.md").write_text(f"# {name}\nYou are {name}.")
    (folder / "config.yaml").write_text(config)
    return folder


def test_reads_name_model_and_skills_from_disk(tmp_path):
    # Arrange
    _write_agent(tmp_path, "atlas")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 1
    assert agents[0].name == "atlas"
    assert agents[0].model == "claude-opus-5"
    assert agents[0].skills == ["research"]
    assert agents[0].status == "active"


def test_malformed_config_yields_a_disabled_agent_with_a_reason(tmp_path):
    # Arrange
    _write_agent(tmp_path, "beacon", config="model: [unclosed\n")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert agents[0].status == "disabled"
    assert agents[0].problem is not None


def test_missing_agent_md_yields_a_disabled_agent(tmp_path):
    # Arrange
    folder = _write_agent(tmp_path, "cinder")
    (folder / "AGENT.md").unlink()

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert agents[0].status == "disabled"
    assert "AGENT.md" in agents[0].problem


def test_missing_agents_root_is_not_an_error(tmp_path):
    assert read_agents(tmp_path / "absent") == []


def test_agents_are_sorted_by_name(tmp_path):
    # Arrange
    _write_agent(tmp_path, "forge")
    _write_agent(tmp_path, "atlas")

    # Act / Assert
    assert [agent.name for agent in read_agents(tmp_path)] == ["atlas", "forge"]


def test_non_numeric_token_limit_yields_disabled_agent(tmp_path):
    # Arrange
    _write_agent(tmp_path, "broken", config="model: claude-opus-5\ntoken_limit: not-a-number\n")
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "token_limit" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


def test_non_numeric_temperature_yields_disabled_agent(tmp_path):
    # Arrange
    _write_agent(
        tmp_path, "broken", config="model: claude-opus-5\ntemperature: hot\n"
    )
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert broken.problem is not None
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses file permissions")
def test_unreadable_agent_md_yields_disabled_agent(tmp_path):
    # Arrange
    folder = _write_agent(tmp_path, "broken")
    agent_file = folder / "AGENT.md"
    agent_file.chmod(0o000)
    _write_agent(tmp_path, "good")

    # Act
    try:
        agents = read_agents(tmp_path)

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
def test_unreadable_config_yaml_yields_disabled_agent(tmp_path):
    # Arrange
    folder = _write_agent(tmp_path, "broken")
    config_file = folder / "config.yaml"
    config_file.chmod(0o000)
    _write_agent(tmp_path, "good")

    # Act
    try:
        agents = read_agents(tmp_path)

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


def test_skills_as_file_yields_disabled_agent(tmp_path):
    # Arrange
    import shutil

    folder = _write_agent(tmp_path, "broken")
    shutil.rmtree(folder / "skills")  # Remove the directory
    (folder / "skills").write_text("I am a file")  # Create a file instead
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "skills" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"


def test_non_scalar_model_yields_disabled_agent(tmp_path):
    # Arrange
    _write_agent(tmp_path, "broken", config="model: [opus, sonnet]\n")
    _write_agent(tmp_path, "good")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 2
    broken = next(a for a in agents if a.name == "broken")
    assert broken.status == "disabled"
    assert "model" in broken.problem
    good = next(a for a in agents if a.name == "good")
    assert good.status == "active"
