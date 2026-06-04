"""Resolve tag aliases and expand search equivalence sets."""

from typing import Dict, Optional, Set

from sqlalchemy.orm import Session

from ..models import Tag, TagAlias

MAX_ALIAS_LENGTH = 255


def resolve_canonical_tag_id(name: str, db: Session) -> Optional[int]:
    """Return canonical tag id for a tag name or alias, or None if unknown.

    Alias mappings take precedence over a separate Tag row with the same spelling.
    """
    normalized = name.lower().strip()
    if not normalized:
        return None

    alias = db.query(TagAlias).filter(TagAlias.alias_name == normalized).first()
    if alias:
        return alias.target_tag_id

    tag = db.query(Tag).filter(Tag.name == normalized).first()
    if tag:
        return tag.id

    return None


def resolve_tag_name_for_upload(name: str, db: Session) -> str:
    """Map an input tag string to the canonical tag name used on posts."""
    normalized = name.lower().strip()
    if not normalized:
        return normalized

    tag = resolve_canonical_tag(normalized, db)
    if tag:
        return tag.name

    return normalized


def expand_tag_ids_for_search(name: str, db: Session) -> Set[int]:
    """
    Expand a search token to all tag IDs that should match as equivalent:
    canonical tag, alias strings (as Tag rows if they exist), and the token itself.
    """
    canonical_id = resolve_canonical_tag_id(name, db)
    if canonical_id is None:
        return set()

    canonical = db.query(Tag).filter(Tag.id == canonical_id).first()
    if not canonical:
        return set()

    names_to_match = {canonical.name}
    alias_rows = db.query(TagAlias.alias_name).filter(
        TagAlias.target_tag_id == canonical_id
    ).all()
    names_to_match.update(row[0] for row in alias_rows)

    tag_ids = {canonical_id}
    extra = db.query(Tag.id).filter(Tag.name.in_(list(names_to_match))).all()
    tag_ids.update(t.id for t in extra)

    return tag_ids


def expand_tag_ids_for_search_batch(names: list, db: Session) -> Dict[str, Set[int]]:
    """Expand multiple search tokens."""
    return {name: expand_tag_ids_for_search(name, db) for name in names}


def resolve_canonical_tag(name: str, db: Session) -> Optional[Tag]:
    """Return the canonical Tag object for a name or alias."""
    tag_id = resolve_canonical_tag_id(name, db)
    if tag_id is None:
        return None
    return db.query(Tag).filter(Tag.id == tag_id).first()
