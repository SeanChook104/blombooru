from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Media
from ..schemas import FileTypeEnum
from .logger import logger
from .thumbnail_generator import generate_thumbnail


def _thumbnail_path_for_media(media: Media) -> Path:
    if media.thumbnail_path:
        return settings.BASE_DIR / media.thumbnail_path
    thumbnail_name = Path(media.filename).stem
    return settings.THUMBNAIL_DIR / f"{thumbnail_name}.jpg"


def regenerate_media_thumbnail(media: Media) -> bool:
    """Regenerate thumbnail file for one media row. Returns True on success."""
    if media.file_type not in (FileTypeEnum.image, FileTypeEnum.gif, FileTypeEnum.video):
        return False

    source_path = settings.BASE_DIR / media.path
    if not source_path.is_file():
        logger.warning(f"Skipping thumbnail regen, missing source: {source_path}")
        return False

    thumbnail_path = _thumbnail_path_for_media(media)
    thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

    if not generate_thumbnail(source_path, thumbnail_path, media.file_type):
        return False

    media.thumbnail_path = str(thumbnail_path.relative_to(settings.BASE_DIR))
    return True


def regenerate_all_thumbnails(db: Session) -> dict:
    """Regenerate thumbnails for all image/gif/video media."""
    media_items = db.query(Media).filter(
        Media.file_type.in_([FileTypeEnum.image, FileTypeEnum.gif, FileTypeEnum.video])
    ).all()

    succeeded = 0
    failed = 0
    skipped = 0

    for media in media_items:
        source_path = settings.BASE_DIR / media.path
        if not source_path.is_file():
            skipped += 1
            continue
        if regenerate_media_thumbnail(media):
            succeeded += 1
        else:
            failed += 1

    db.commit()
    return {
        "total": len(media_items),
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
    }
