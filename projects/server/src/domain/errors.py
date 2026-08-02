class RecordNotFound(Exception):
    """Raised when a repository lookup finds no row matching the given id."""


class IntegrityConflict(Exception):
    """Raised when a repository write violates a database integrity constraint
    (a unique or foreign-key constraint)."""
