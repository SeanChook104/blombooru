import csv
import io
from typing import List, Optional

from fastapi import (APIRouter, Depends, File, HTTPException, Request,
                     UploadFile)
from pydantic import BaseModel
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from ..auth import require_admin_mode
from ..database import get_db
from ..models import Tag, TagAlias, TagCategoryEnum, User, blombooru_media_tags
from ..utils.logger import logger
from ..utils.request_helpers import safe_error_detail
from ..utils.cache import cache_response, invalidate_tag_cache
from ..utils.tag_resolver import MAX_ALIAS_LENGTH

router = APIRouter(prefix="/api/tags-management", tags=["tag-management"])

def parse_tag_category(category_num: str) -> TagCategoryEnum:
    """Convert numeric category to enum"""
    mapping = {
        "0": TagCategoryEnum.general,
        "1": TagCategoryEnum.artist,
        "3": TagCategoryEnum.copyright,
        "4": TagCategoryEnum.character,
        "5": TagCategoryEnum.meta
    }
    return mapping.get(category_num, TagCategoryEnum.general)

def parse_aliases(aliases_str: str) -> List[str]:
    """Parse comma-separated aliases"""
    if not aliases_str or aliases_str.strip() == '':
        return []
    
    aliases_str = aliases_str.strip('"\'')
    
    return [tag.strip() for tag in aliases_str.split(',') if tag.strip()]


def _normalize_alias_names(aliases: List[str], canonical_name: str) -> List[str]:
    """Normalize and dedupe alias names; exclude canonical name."""
    seen = set()
    result = []
    canonical_lower = canonical_name.lower()
    for raw in aliases:
        name = raw.strip().lower()
        if not name or name == canonical_lower or name in seen:
            continue
        if len(name) > MAX_ALIAS_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Alias too long (max {MAX_ALIAS_LENGTH}): {name[:50]}...",
            )
        seen.add(name)
        result.append(name)
    return result


def _validate_aliases_for_tag(
    db: Session,
    canonical: Tag,
    alias_names: List[str],
) -> None:
    """Ensure alias strings are not already linked to a different canonical tag."""
    for alias_name in alias_names:
        if alias_name == canonical.name:
            continue
        other_alias = db.query(TagAlias).filter(
            TagAlias.alias_name == alias_name,
            TagAlias.target_tag_id != canonical.id,
        ).first()
        if other_alias:
            raise HTTPException(
                status_code=400,
                detail=f"'{alias_name}' is already an alias of another tag",
            )


def _tags_to_merge_for_aliases(
    db: Session, canonical: Tag, alias_names: List[str]
) -> List[Tag]:
    """Return existing Tag rows whose names should be merged into canonical."""
    sources = []
    seen_ids = set()
    for alias_name in alias_names:
        existing_tag = db.query(Tag).filter(Tag.name == alias_name).first()
        if (
            existing_tag
            and existing_tag.id != canonical.id
            and existing_tag.id not in seen_ids
        ):
            sources.append(existing_tag)
            seen_ids.add(existing_tag.id)
    return sources


def _merge_source_tags_into_canonical(
    db: Session,
    canonical: Tag,
    sources: List[Tag],
    *,
    register_aliases: bool = True,
) -> List[str]:
    """Retag media from sources onto canonical, optionally register source names as aliases, delete sources."""
    if not sources:
        return []

    merged_names = []
    for source in sources:
        media_rows = db.execute(
            select(blombooru_media_tags.c.media_id).where(
                blombooru_media_tags.c.tag_id == source.id
            )
        ).fetchall()

        for (media_id,) in media_rows:
            has_canonical = db.execute(
                select(blombooru_media_tags.c.media_id).where(
                    blombooru_media_tags.c.media_id == media_id,
                    blombooru_media_tags.c.tag_id == canonical.id,
                )
            ).first()
            if not has_canonical:
                db.execute(
                    insert(blombooru_media_tags).values(
                        media_id=media_id, tag_id=canonical.id
                    )
                )
            db.execute(
                delete(blombooru_media_tags).where(
                    blombooru_media_tags.c.media_id == media_id,
                    blombooru_media_tags.c.tag_id == source.id,
                )
            )

        if register_aliases and source.name != canonical.name:
            existing_alias = db.query(TagAlias).filter(
                TagAlias.alias_name == source.name
            ).first()
            if not existing_alias:
                db.add(
                    TagAlias(
                        alias_name=source.name,
                        target_tag_id=canonical.id,
                    )
                )
            elif existing_alias.target_tag_id != canonical.id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Alias '{source.name}' already belongs to another tag",
                )

        merged_names.append(source.name)
        db.delete(source)

    return merged_names


class AliasesUpdate(BaseModel):
    aliases: List[str]


class MergeTagsRequest(BaseModel):
    canonical_tag_id: int
    source_tag_ids: List[int]


@router.post("/import-csv")
async def import_tags_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Import tags from CSV file"""
    
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    try:
        content = await file.read()
        csv_text = content.decode('utf-8')
        csv_reader = csv.reader(io.StringIO(csv_text))
        
        stats = {
            "tags_created": 0,
            "tags_updated": 0,
            "aliases_created": 0,
            "errors": []
        }
        
        for row_num, row in enumerate(csv_reader, 1):
            try:
                if len(row) < 4:
                    stats["errors"].append(f"Row {row_num}: Invalid format (expected 4 columns)")
                    continue
                
                tag_name = row[0].strip().lower()
                category = parse_tag_category(row[1].strip())
                # Skip row[2] (usage count)
                aliases_str = row[3].strip()
                
                if not tag_name:
                    continue
                
                tag = db.query(Tag).filter(Tag.name == tag_name).first()
                
                if tag:
                    if tag.category != category:
                        tag.category = category
                        stats["tags_updated"] += 1
                else:
                    tag = Tag(
                        name=tag_name,
                        category=category,
                        post_count=0
                    )
                    db.add(tag)
                    db.flush()  # Get the ID
                    stats["tags_created"] += 1
                
                alias_names = parse_aliases(aliases_str)
                
                for alias_name in alias_names:
                    alias_name = alias_name.lower()
                    
                    existing_alias = db.query(TagAlias).filter(
                        TagAlias.alias_name == alias_name
                    ).first()
                    
                    if not existing_alias:
                        alias = TagAlias(
                            alias_name=alias_name,
                            target_tag_id=tag.id
                        )
                        db.add(alias)
                        stats["aliases_created"] += 1
                
            except Exception as e:
                stats["errors"].append(f"Row {row_num}: {str(e)}")
                continue
        
        db.commit()
        invalidate_tag_cache()
        
        return {
            "success": True,
            "stats": stats
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail("Failed to import CSV", e))

@router.get("/stats")
@cache_response(expire=3600, key_prefix="tags")
async def get_tag_stats(
    request: Request,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Get tag statistics"""
    
    total_tags = db.query(func.count(Tag.id)).scalar()
    total_aliases = db.query(func.count(TagAlias.id)).scalar()
    
    category_counts = db.query(
        Tag.category,
        func.count(Tag.id)
    ).group_by(Tag.category).all()
    
    return {
        "total_tags": total_tags or 0,
        "total_aliases": total_aliases or 0,
        "tags_by_category": {
            cat.value: count for cat, count in category_counts
        } if category_counts else {}
    }

@router.delete("/clear-all")
async def clear_all_tags(
    confirm: bool = False,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Clear all tags from database (dangerous!)"""
    
    if not confirm:
        raise HTTPException(
            status_code=400, 
            detail="Must confirm deletion by setting confirm=true"
        )
    
    try:
        db.query(TagAlias).delete()
        db.query(Tag).delete()
        db.commit()
        invalidate_tag_cache()
        
        # Also clear shared database if enabled
        from ..config import settings
        if settings.SHARED_TAGS_ENABLED:
            from ..database import get_shared_db, is_shared_db_available
            if is_shared_db_available():
                shared_db_gen = get_shared_db()
                shared_db = next(shared_db_gen, None)
                if shared_db:
                    try:
                        from ..services.shared_tags import SharedTagService
                        service = SharedTagService(db, shared_db)
                        service.clear_all_shared()
                    finally:
                        try:
                            next(shared_db_gen, None)
                        except StopIteration:
                            pass
        
        return {"success": True, "message": "All tags cleared"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail("Failed to clear tags", e))

@router.get("/search")
@cache_response(expire=3600, key_prefix="tags")
async def search_tags(
    request: Request,
    q: str,
    limit: int = 50,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Search tags for management"""
    
    query = db.query(Tag)
    
    if q:
        query = query.filter(Tag.name.ilike(f"%{q}%"))
    
    tags = query.order_by(Tag.post_count.desc()).limit(limit).all()
    
    results = []
    for tag in tags:
        aliases = db.query(TagAlias).filter(
            TagAlias.target_tag_id == tag.id
        ).all()
        
        results.append({
            "id": tag.id,
            "name": tag.name,
            "category": tag.category.value,
            "post_count": tag.post_count,
            "aliases": [a.alias_name for a in aliases]
        })
    
    return results


@router.post("/merge")
async def merge_tags(
    body: MergeTagsRequest,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db),
):
    """Merge source tags into a canonical tag (retag media, create aliases, delete sources)."""
    from ..routes.media import update_tag_counts

    canonical = db.query(Tag).filter(Tag.id == body.canonical_tag_id).first()
    if not canonical:
        raise HTTPException(status_code=404, detail="Canonical tag not found")

    source_ids = [sid for sid in body.source_tag_ids if sid != canonical.id]
    if not source_ids:
        raise HTTPException(status_code=400, detail="No source tags to merge")

    sources = db.query(Tag).filter(Tag.id.in_(source_ids)).all()
    if len(sources) != len(source_ids):
        raise HTTPException(status_code=404, detail="One or more source tags not found")

    affected_tag_ids = {canonical.id, *(s.id for s in sources)}

    try:
        merged = _merge_source_tags_into_canonical(db, canonical, sources)
        db.flush()
        update_tag_counts(db, list(affected_tag_ids))
        db.commit()
        invalidate_tag_cache()

        return {
            "success": True,
            "canonical": canonical.name,
            "merged": merged,
            "aliases_created": merged,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail("Failed to merge tags", e))


@router.get("/{tag_id}")
async def get_tag_detail(
    tag_id: int,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db),
):
    """Get tag with aliases for management."""
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    aliases = db.query(TagAlias).filter(TagAlias.target_tag_id == tag.id).all()
    return {
        "id": tag.id,
        "name": tag.name,
        "category": tag.category.value,
        "post_count": tag.post_count,
        "aliases": [a.alias_name for a in aliases],
    }


@router.put("/{tag_id}/aliases")
async def update_tag_aliases(
    tag_id: int,
    body: AliasesUpdate,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db),
):
    """Replace all aliases for a canonical tag.

    Existing tags matching alias names are merged into the canonical automatically.
    """
    from ..routes.media import update_tag_counts

    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    try:
        alias_names = _normalize_alias_names(body.aliases, tag.name)
        _validate_aliases_for_tag(db, tag, alias_names)

        sources_to_merge = _tags_to_merge_for_aliases(db, tag, alias_names)
        merged = _merge_source_tags_into_canonical(
            db, tag, sources_to_merge, register_aliases=False
        )

        db.flush()
        db.query(TagAlias).filter(TagAlias.target_tag_id == tag.id).delete()
        for alias_name in alias_names:
            db.add(TagAlias(alias_name=alias_name, target_tag_id=tag.id))

        db.flush()
        update_tag_counts(db, [tag.id])
        db.commit()
        invalidate_tag_cache()
        return {
            "success": True,
            "id": tag.id,
            "name": tag.name,
            "aliases": alias_names,
            "merged": merged,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail("Failed to update aliases", e))


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Delete a specific tag"""
    
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    tag_name = tag.name  # Save name before deletion
    
    try:
        db.delete(tag)
        db.commit()
        invalidate_tag_cache()
        
        # Also delete from shared database if enabled
        from ..config import settings
        if settings.SHARED_TAGS_ENABLED:
            from ..database import get_shared_db, is_shared_db_available
            if is_shared_db_available():
                shared_db_gen = get_shared_db()
                shared_db = next(shared_db_gen, None)
                if shared_db:
                    try:
                        from ..services.shared_tags import SharedTagService
                        service = SharedTagService(db, shared_db)
                        service.delete_from_shared(tag_name)
                    finally:
                        try:
                            next(shared_db_gen, None)
                        except StopIteration:
                            pass
        
        return {"success": True, "tag_name": tag_name, "message": f"Tag '{tag_name}' deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail("Failed to delete tag", e))
