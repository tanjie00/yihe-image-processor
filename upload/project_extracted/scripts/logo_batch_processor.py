#!/usr/bin/env python3
"""
Batch Logo Watermark Processor — N × M Cartesian Product
=========================================================

Core execution function for multi-logo × multi-image batch compositing.

Features:
  • Pixel-precise positioning (x_offset_px, y_offset_px, target_width_px)
  • Logo pre-processing: resize + opacity applied ONCE per logo, reused in inner loop
  • concurrent.futures.ThreadPoolExecutor for parallel image compositing
  • Per-logo subdirectory output: output_dir/{logo_name}/{subdirs}/{logo_name}_{img}.png
  • Directory structure replication: source subdirectories are preserved 1:1
  • Aggressive memory cleanup (image.close() + gc.collect()) per logo batch
  • RGBA transparency fully preserved throughout the pipeline
  • Directory support: pass a folder path and it will be recursively scanned
    for image files (ignoring hidden files like .DS_Store)

Usage:
    from logo_batch_processor import start_pixel_batch_processing, PixelConfig

    # Files OR directories are accepted in both lists
    config = PixelConfig(x_offset_px=50, y_offset_px=50, target_width_px=200, opacity=0.8)
    result = start_pixel_batch_processing(
        logos_list=["logos/brand_a.png", "logos/brand_b.png"],
        images_list=["images/prod_001.jpg", "images/dir_of_photos/"],
        config_px=config,
        output_dir="./output",
    )
    print(f"Done: {result['succeeded']}/{result['total']} in {result['elapsed_s']}s")
"""

from __future__ import annotations

import gc
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional

from PIL import Image

logger = logging.getLogger(__name__)

# Pillow 9.x / 10.x compatible resampling constant
try:
    _LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    _LANCZOS = Image.LANCZOS  # type: ignore[attr-defined]

# Supported image extensions (lower-case, with dot)
IMAGE_EXTENSIONS: frozenset[str] = frozenset({
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif", ".avif",
})


# ═══════════════════════════════════════════════════════════════════════════
# Data Structures
# ═══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class PixelConfig:
    """
    All positioning / sizing parameters — strictly in **pixels**.

    Attributes
    ----------
    x_offset_px : int
        Distance from the left edge of the base image to the logo's left edge.
    y_offset_px : int
        Distance from the top edge of the base image to the logo's top edge.
    target_width_px : int
        Resize every logo to this width; height is calculated from aspect ratio.
    opacity : float
        Global opacity multiplier applied to the logo's alpha channel (0.0–1.0).
    """
    x_offset_px: int = 0
    y_offset_px: int = 0
    target_width_px: int = 200
    opacity: float = 1.0


@dataclass
class TaskResult:
    """Outcome of a single (logo × image) compositing task."""
    logo_name: str
    image_name: str
    output_path: str
    success: bool
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════
# Internal Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _is_hidden(path: Path) -> bool:
    """Return True if any component of the path starts with '.' (hidden)."""
    return any(part.startswith(".") for part in path.parts)


def _scan_paths(raw_list: List[str | Path]) -> tuple[list[Path], Path | None]:
    """
    Expand a mixed list of **files and directories** into a flat, sorted list
    of image file paths, along with the common root directory for relative paths.

    • If a path is a **file** → included directly (if extension matches).
    • If a path is a **directory** → recursively scanned with ``pathlib.rglob``.
    • Hidden files (``.DS_Store``, ``.gitkeep``, etc.) are silently skipped.

    Returns
    -------
    (file_list, common_root)
        file_list: sorted list of resolved image file Paths
        common_root: the deepest common parent directory among all directories
                     in raw_list, or None if only individual files were given.
    """
    result: list[Path] = []
    dirs_seen: list[Path] = []
    for raw in raw_list:
        p = Path(raw).resolve()
        if p.is_file():
            if p.suffix.lower() in IMAGE_EXTENSIONS and not _is_hidden(p):
                result.append(p)
        elif p.is_dir():
            dirs_seen.append(p)
            for child in p.rglob("*"):
                if (
                    child.is_file()
                    and child.suffix.lower() in IMAGE_EXTENSIONS
                    and not _is_hidden(child)
                ):
                    result.append(child)
        else:
            logger.warning("Path not found, skipping: %s", p)

    # Determine common root for relative path computation
    common_root: Path | None = None
    if dirs_seen:
        common_root = dirs_seen[0]
        for d in dirs_seen[1:]:
            # Find common parent
            try:
                common_root = Path(os.path.commonpath([str(common_root), str(d)]))
            except ValueError:
                common_root = None
                break

    return sorted(result), common_root


def _preprocess_logo(logo_path: Path, config: PixelConfig) -> Image.Image:
    """
    Pre-process a single logo file: convert to RGBA → resize → apply opacity.

    This is executed **once per logo** (before entering the image loop),
    so the expensive resize + alpha compositing is never repeated.
    """
    logo = Image.open(logo_path).convert("RGBA")

    # Resize: width = target_width_px, height derived from aspect ratio
    if config.target_width_px > 0 and logo.width != config.target_width_px:
        ratio = config.target_width_px / logo.width
        new_h = max(1, round(logo.height * ratio))
        logo = logo.resize((config.target_width_px, new_h), _LANCZOS)

    # Apply opacity by scaling the alpha channel
    if config.opacity < 1.0:
        r, g, b, a = logo.split()
        a = a.point(lambda v: int(v * config.opacity))
        logo = Image.merge("RGBA", (r, g, b, a))

    return logo


def _composite_one(
    logo_img: Image.Image,
    image_path: Path,
    config: PixelConfig,
    output_path: Path,
) -> TaskResult:
    """
    Composite a pre-processed logo onto a single base image and save as PNG.

    Thread-safe: each call opens its own base image; ``logo_img`` is read-only.
    """
    img_stem = image_path.stem
    try:
        base = Image.open(image_path).convert("RGBA")

        # Paste logo at pixel-precise offset; logo_img itself is the alpha mask
        base.paste(logo_img, (config.x_offset_px, config.y_offset_px), logo_img)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        base.save(str(output_path), "PNG")
        base.close()

        return TaskResult(
            logo_name="",
            image_name=img_stem,
            output_path=str(output_path),
            success=True,
        )
    except Exception as exc:
        logger.exception("Compositing failed for %s", image_path)
        return TaskResult(
            logo_name="",
            image_name=img_stem,
            output_path=str(output_path),
            success=False,
            error=str(exc),
        )


# ═══════════════════════════════════════════════════════════════════════════
# Core API
# ═══════════════════════════════════════════════════════════════════════════

def start_pixel_batch_processing(
    logos_list: List[str | Path],
    images_list: List[str | Path],
    config_px: PixelConfig,
    *,
    output_dir: str | Path = "./output",
    max_workers: int | None = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> dict:
    """
    Execute **N-logos × M-images** batch watermark compositing.

    Processing order (Cartesian product)::

        for logo in logos_list:       ← outer: resize logo ONCE
            ThreadPoolExecutor:
                for image in images:  ← inner: concurrent compositing
                    paste logo @ (x_px, y_px) → save

    Output directory structure (preserves source subdirectory hierarchy)::

        output_dir/
        ├── brand_a/
        │   ├── brand_a_product_001.png
        │   ├── brand_a_product_002.png
        │   ├── subfolder/
        │   │   ├── brand_a_nested_photo.png
        │   │   └── …
        │   └── …
        ├── brand_b/
        │   ├── brand_b_product_001.png
        │   ├── subfolder/
        │   │   └── brand_b_nested_photo.png
        │   └── …

    Naming convention: ``{Logo文件名}_{原图片文件名}.png``

    Parameters
    ----------
    logos_list : list[str | Path]
        Ordered list of logo **file or directory** paths.
        Directories are recursively scanned for image files.
        Processing follows list index order.
    images_list : list[str | Path]
        List of source image **file or directory** paths.
        Directories are recursively scanned for image files.
    config_px : PixelConfig
        Pixel-level positioning / sizing configuration (shared by all logos).
    output_dir : str | Path
        Root output directory. Auto-created if missing.
    max_workers : int | None
        Thread-pool size for concurrent compositing.
        Defaults to ``min(cpu_count, 16)``.
    progress_callback : callable | None
        Signature ``callback(current: int, total: int, message: str)``.
        Called from the **main thread** after each task completes.

    Returns
    -------
    dict
        ``{total, succeeded, failed, elapsed_s, output_dir, results}``
    """
    t0 = time.perf_counter()

    # ── Validate inputs ────────────────────────────────────────────────────
    if not logos_list:
        raise ValueError("logos_list cannot be empty")
    if not images_list:
        raise ValueError("images_list cannot be empty")

    # ★ Expand directories → flat image file lists ★
    resolved_logos, _ = _scan_paths(logos_list)
    resolved_images, images_root = _scan_paths(images_list)

    if not resolved_logos:
        raise ValueError(
            f"No image files found in logos_list (searched {len(logos_list)} path(s))"
        )
    if not resolved_images:
        raise ValueError(
            f"No image files found in images_list (searched {len(images_list)} path(s))"
        )

    logger.info("Resolved: %d logo(s), %d image(s)", len(resolved_logos), len(resolved_images))

    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)

    # Clamp config to safe bounds
    config = PixelConfig(
        x_offset_px=max(0, config_px.x_offset_px),
        y_offset_px=max(0, config_px.y_offset_px),
        target_width_px=max(1, config_px.target_width_px),
        opacity=max(0.0, min(1.0, config_px.opacity)),
    )

    workers = max_workers or min(os.cpu_count() or 4, 16)
    total = len(resolved_logos) * len(resolved_images)
    completed = 0
    all_results: list[TaskResult] = []

    # ── Outer loop: each Logo ──────────────────────────────────────────────
    for logo_idx, logo_path in enumerate(resolved_logos):
        logo_stem = logo_path.stem  # filename without extension

        # Skip missing logo files (record as bulk failures)
        if not logo_path.is_file():
            logger.error("Logo not found, skipping: %s", logo_path)
            for img_path in resolved_images:
                all_results.append(TaskResult(
                    logo_name=logo_stem,
                    image_name=img_path.stem,
                    output_path="",
                    success=False,
                    error=f"Logo file not found: {logo_path}",
                ))
            completed += len(resolved_images)
            continue

        # Create per-logo sub-directory (path protection)
        logo_dir = root / logo_stem
        logo_dir.mkdir(parents=True, exist_ok=True)

        # ★ STEP 1 — Pre-process logo: resize + opacity (ONCE per logo) ★
        if progress_callback:
            progress_callback(
                completed, total,
                f"[Logo {logo_idx + 1}/{len(resolved_logos)}] 预处理 {logo_stem}",
            )
        logo_img = _preprocess_logo(logo_path, config)

        # ★ STEP 2 — Threaded inner loop: composite logo onto every image ★
        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_map: dict = {}
            for img_path in resolved_images:
                out_name = f"{logo_stem}_{img_path.stem}.png"

                # Preserve subdirectory structure from source
                if images_root:
                    try:
                        rel = img_path.relative_to(images_root)
                        if rel.parent != Path('.'):
                            out_path = logo_dir / rel.parent / out_name
                        else:
                            out_path = logo_dir / out_name
                    except ValueError:
                        out_path = logo_dir / out_name
                else:
                    out_path = logo_dir / out_name

                future = pool.submit(
                    _composite_one, logo_img, img_path, config, out_path,
                )
                future_map[future] = img_path.stem

            # Collect results as they finish (main thread — no race)
            for future in as_completed(future_map):
                completed += 1
                result = future.result()
                result.logo_name = logo_stem
                all_results.append(result)

                if progress_callback:
                    mark = "✓" if result.success else "✗"
                    msg = (
                        f"[{completed}/{total}] {mark} "
                        f"{logo_stem} × {result.image_name}"
                    )
                    progress_callback(completed, total, msg)

        # ★ STEP 3 — Memory cleanup after each logo batch ★
        logo_img.close()
        del logo_img
        gc.collect()

    # ── Summary ────────────────────────────────────────────────────────────
    elapsed = time.perf_counter() - t0
    succeeded = sum(1 for r in all_results if r.success)
    failed = sum(1 for r in all_results if not r.success)

    summary = {
        "total": total,
        "succeeded": succeeded,
        "failed": failed,
        "elapsed_s": round(elapsed, 2),
        "output_dir": str(root),
        "results": all_results,
    }

    logger.info(
        "Batch complete: %d/%d succeeded in %.2fs → %s",
        succeeded, total, elapsed, root,
    )
    return summary


# ═══════════════════════════════════════════════════════════════════════════
# CLI — Quick Test / Standalone Execution
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    def _cli_progress(cur: int, tot: int, msg: str) -> None:
        print(f"\r  {msg}", end="", flush=True)

    parser = argparse.ArgumentParser(
        description="Batch Logo Watermark Processor (N × M)",
    )
    parser.add_argument("logos", nargs="+",
                        help="Logo file/dir paths (dirs are recursively scanned)")
    parser.add_argument(
        "--images", nargs="+", required=True,
        help="Image file/dir paths (dirs are recursively scanned)",
    )
    parser.add_argument("--output", default="./output", help="Output root dir")
    parser.add_argument("--x", type=int, default=50, help="X offset (px)")
    parser.add_argument("--y", type=int, default=50, help="Y offset (px)")
    parser.add_argument("--width", type=int, default=200, help="Logo width (px)")
    parser.add_argument("--opacity", type=float, default=1.0, help="Opacity 0.0–1.0")
    parser.add_argument("--workers", type=int, default=None, help="Thread pool size")
    cli = parser.parse_args()

    # Resolve paths (auto-scan directories)
    resolved_logos, _ = _scan_paths(cli.logos)
    resolved_images, _ = _scan_paths(cli.images)

    if not resolved_logos:
        parser.error(f"No image files found in logo paths: {cli.logos}")
    if not resolved_images:
        parser.error(f"No image files found in image paths: {cli.images}")

    cfg = PixelConfig(cli.x, cli.y, cli.width, cli.opacity)

    print(f"Logos: {len(resolved_logos)} | Images: {len(resolved_images)} | Total: {len(resolved_logos) * len(resolved_images)}")
    print(f"Config: x={cfg.x_offset_px}px, y={cfg.y_offset_px}px, width={cfg.target_width_px}px, opacity={cfg.opacity}")
    print(f"Output: {cli.output}\n")

    result = start_pixel_batch_processing(
        resolved_logos, resolved_images, cfg,
        output_dir=cli.output,
        max_workers=cli.workers,
        progress_callback=_cli_progress,
    )

    print(f"\n\n{'='*60}")
    print(f"  Succeeded : {result['succeeded']}")
    print(f"  Failed    : {result['failed']}")
    print(f"  Total     : {result['total']}")
    print(f"  Elapsed   : {result['elapsed_s']}s")
    print(f"  Output    : {result['output_dir']}")
    print(f"{'='*60}")

    if result["failed"] > 0:
        print("\nFailed files:")
        for r in result["results"]:
            if not r.success:
                print(f"  ✗ {r.logo_name} × {r.image_name}: {r.error}")
