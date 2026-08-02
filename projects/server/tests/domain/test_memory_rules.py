from domain.memory import DIGEST_SECTIONS, empty_digest, should_compact

# Spec §5 defaults, passed in as plain values — domain/ takes no Settings object.
MAX_ENTRIES = 10
MAX_BYTES = 32_768


def test_no_compaction_below_both_thresholds():
    assert should_compact(3, 1_000, MAX_ENTRIES, MAX_BYTES) is False


def test_entry_count_threshold_triggers_compaction():
    assert should_compact(10, 10, MAX_ENTRIES, MAX_BYTES) is True


def test_byte_threshold_triggers_compaction():
    assert should_compact(1, 32_768, MAX_ENTRIES, MAX_BYTES) is True


def test_empty_journal_never_triggers_compaction():
    assert should_compact(0, 0, MAX_ENTRIES, MAX_BYTES) is False


def test_empty_digest_contains_every_required_section():
    # Act
    digest = empty_digest("api-service")

    # Assert
    for section in DIGEST_SECTIONS:
        assert f"## {section}" in digest
