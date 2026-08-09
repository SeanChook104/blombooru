import math
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..auth import User, require_admin_mode
from ..config import settings
from ..database import get_db
from ..models import CanvasHistory
from ..schemas import CanvasHistoryCreate
from ..utils.logger import logger

router = APIRouter(prefix="/api/canvas-history", tags=["canvas-history"])

def canonical_media_ids(media_ids: List[int]) -> str:
    """Unique + sorted + comma-joined, so identical canvases compare equal."""
    return ",".join(str(mid) for mid in sorted(set(media_ids)))

def parse_media_ids(raw: str) -> List[int]:
    """Inverse of canonical_media_ids, tolerant of malformed rows."""
    if not raw:
        return []
    return [int(part) for part in raw.split(",") if part.strip().isdigit()]

def serialize(entry: CanvasHistory) -> dict:
    return {
        "id": entry.id,
        "media_ids": parse_media_ids(entry.media_ids),
        "item_count": entry.item_count,
        "created_at": entry.created_at,
        "last_opened_at": entry.last_opened_at,
    }

@router.post("")
@router.post("/")
async def record_canvas(
    data: CanvasHistoryCreate,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """
    Record that a canvas was opened with a set of media.

    Deduplicated: opening the same set again bumps last_opened_at on the
    existing row instead of creating a second entry.
    """
    if not data.media_ids:
        raise HTTPException(status_code=400, detail="media_ids must not be empty")

    key = canonical_media_ids(data.media_ids)

    existing = db.query(CanvasHistory).filter(CanvasHistory.media_ids == key).first()
    if existing:
        existing.last_opened_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        return serialize(existing)

    entry = CanvasHistory(
        media_ids=key,
        item_count=len(key.split(",")),
        created_at=datetime.now(timezone.utc),
        last_opened_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    logger.info(f"Recorded canvas history entry {entry.id} with {entry.item_count} item(s)")
    return serialize(entry)

@router.get("")
@router.get("/")
async def list_canvas_history(
    page: int = Query(default=1, ge=1),
    limit: Optional[int] = Query(default=None),
    db: Session = Depends(get_db)
):
    """List past canvases, most recently opened first."""
    effective_limit = limit if limit and limit > 0 else settings.get_items_per_page()

    total = db.query(CanvasHistory).count()
    pages = max(1, math.ceil(total / effective_limit)) if total else 1

    entries = (
        db.query(CanvasHistory)
        .order_by(desc(CanvasHistory.last_opened_at))
        .offset((page - 1) * effective_limit)
        .limit(effective_limit)
        .all()
    )

    return {
        "items": [serialize(entry) for entry in entries],
        "total": total,
        "page": page,
        "pages": pages,
    }

@router.delete("/{entry_id}")
async def delete_canvas_history_entry(
    entry_id: int,
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Delete a single canvas history entry."""
    entry = db.query(CanvasHistory).filter(CanvasHistory.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Canvas history entry not found")

    db.delete(entry)
    db.commit()

    return {"message": "Canvas history entry deleted"}

@router.delete("")
@router.delete("/")
async def clear_canvas_history(
    current_user: User = Depends(require_admin_mode),
    db: Session = Depends(get_db)
):
    """Delete every canvas history entry."""
    deleted = db.query(CanvasHistory).delete()
    db.commit()

    return {"message": f"Deleted {deleted} canvas history entr(y/ies)"}
