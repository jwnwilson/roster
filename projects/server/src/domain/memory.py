DIGEST_SECTIONS: tuple[str, ...] = (
    "Overview",
    "Architecture",
    "Conventions",
    "Decisions",
    "Gotchas",
    "Glossary",
)


def should_compact(
    entry_count: int, total_bytes: int, max_entries: int, max_bytes: int
) -> bool:
    """Spec §5: compaction fires on entry count OR raw journal size. Never on an empty journal.

    Takes plain values, not a Settings object — domain/ imports nothing from other layers.
    """
    if entry_count == 0:
        return False
    return entry_count >= max_entries or total_bytes >= max_bytes


def empty_digest(project_name: str) -> str:
    sections = "\n\n".join(f"## {section}\n" for section in DIGEST_SECTIONS)
    return f"# {project_name} — project memory\n\n{sections}"
