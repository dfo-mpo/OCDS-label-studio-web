#!/usr/bin/env python3
"""
convert_to_dzi.py

Convert images in a given directory to DZI format for OpenSeadragon.
Requires the input path. Supports --force and --clear.
"""

import argparse
from pathlib import Path
import pyvips
from tqdm import tqdm
import sys
import shutil

def convert_images_to_dzi(input_dir: Path, output_dir: Path, force=False, clear=False):
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if clear:
        print(f"[CLEAR] Deleting all DZI files in {output_dir}")
        for item in output_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            elif item.suffix.lower() == ".dzi":
                item.unlink()
        print(f"[SUCCESS] DZI directory cleared: {output_dir}")
        return

    # Validate input directory
    if not input_dir.exists() or not any(input_dir.iterdir()):
        print(f"[ERROR] Input directory {input_dir} does not exist or is empty")
        sys.exit(1)

    # Scan for images
    images = [f for f in input_dir.iterdir() if f.suffix.lower() in [".jpg",".jpeg",".png",".tif",".tiff"]]
    if not images:
        print(f"[INFO] No images found in {input_dir}")
        return

    print(f"[INFO] Found {len(images)} images in {input_dir}")

    for img in tqdm(images, desc="Converting images"):
        name = img.stem
        out_dzi = output_dir / f"{name}.dzi"
        out_dir = output_dir / f"{name}_files"

        if out_dzi.exists() and not force:
            print(f"[SKIP] {img.name} already converted")
            continue

        # Remove previous outputs if force
        if out_dzi.exists():
            out_dzi.unlink()
        if out_dir.exists():
            shutil.rmtree(out_dir)

        # Convert using pyvips
        try:
            image = pyvips.Image.new_from_file(str(img), access="sequential")
            image.dzsave(str(output_dir / name), suffix=".jpg", tile_size=256, overlap=1)
            print(f"[CONVERT] {img.name}")
        except Exception as e:
            print(f"[ERROR] Failed to convert {img.name}: {e}", file=sys.stderr)

    print("[SUCCESS] Conversion complete")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert images to DZI format")
    # Make input optional with nargs='?' so default works
    parser.add_argument(
        "input",
        nargs="?",
        default="./hugeimages",
        help="Input directory containing images (default: ./hugeimages; ignored if --clear)"
    )
    parser.add_argument("--output", default="./dzi", help="Output DZI directory")
    parser.add_argument("--force", action="store_true", help="Reconvert all images")
    parser.add_argument("--clear", action="store_true", help="Delete all DZI outputs and exit")

    args = parser.parse_args()

    convert_images_to_dzi(
        input_dir=args.input,
        output_dir=args.output,
        force=args.force,
        clear=args.clear
    )