from pathlib import Path

import cv2
from PIL import Image

from ..schemas import FileTypeEnum
from .logger import logger

THUMBNAIL_SIZE = (300, 300)


def generate_image_thumbnail(source_path: Path, thumbnail_path: Path) -> bool:
    """Generate thumbnail for an image"""
    try:
        with Image.open(source_path) as img:
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            img.save(thumbnail_path, 'JPEG', quality=85, optimize=True)
        return True
    except Exception as e:
        logger.error(f"Error generating image thumbnail: {e}")
        return False


def _read_video_frame(cap: cv2.VideoCapture, at_ratio: float) -> tuple[bool, object | None]:
    """Read a single frame at a fraction of total length (0.0 = start, 0.5 = midpoint)."""
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    if frame_count and frame_count > 1 and at_ratio > 0:
        target_frame = int(frame_count * at_ratio)
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, target_frame))
    else:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    ret, frame = cap.read()
    if not ret or frame is None:
        return False, None
    return True, frame


def _save_video_frame(frame, thumbnail_path: Path) -> bool:
    try:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(frame)
        img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        img.save(thumbnail_path, 'JPEG', quality=85, optimize=True)
        return True
    except Exception as e:
        logger.error(f"Error saving video thumbnail frame: {e}")
        return False


def generate_video_thumbnail(source_path: Path, thumbnail_path: Path) -> bool:
    """Generate thumbnail from video; prefer midpoint, fall back to first frame."""
    cap = None
    try:
        cap = cv2.VideoCapture(str(source_path))
        if not cap.isOpened():
            return False

        for at_ratio in (0.5, 0.0):
            ret, frame = _read_video_frame(cap, at_ratio)
            if ret and _save_video_frame(frame, thumbnail_path):
                return True

        return False
    except Exception as e:
        logger.error(f"Error generating video thumbnail: {e}")
        return False
    finally:
        if cap is not None:
            cap.release()


def generate_thumbnail(source_path: Path, thumbnail_path: Path, file_type: FileTypeEnum) -> bool:
    """Generate thumbnail based on file type"""
    thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

    if file_type in [FileTypeEnum.image, FileTypeEnum.gif]:
        return generate_image_thumbnail(source_path, thumbnail_path)
    elif file_type == FileTypeEnum.video:
        return generate_video_thumbnail(source_path, thumbnail_path)

    return False
