#!/usr/bin/env python3
"""Prepare locally owned Dino Island assets for the browser, without executables.

Run: UV_CACHE_DIR=/tmp/dino-uv-cache uv run --with pillow python scripts/prepare-assets.py
The source extraction remains untouched. Outputs are local, ignored build inputs.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGE_FORMATS = {".tga", ".bmp", ".png", ".jpg", ".jpeg"}
# This positive list intentionally excludes binaries, videos, installers and scripts.
RUNTIME_FORMATS = {
    ".mesh", ".skin", ".skel", ".anim", ".blf", ".lnd", ".raw", ".imp",
    ".ini", ".wld", ".bbi", ".bvi", ".bfi", ".bai", ".bwi", ".bsi", ".bni",
    ".bei", ".gen", ".shw", ".loc", ".dic", ".fnt", ".seq", ".bad", ".bgd",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "references/original/game")
    args = parser.parse_args()
    data = args.source.resolve() / "Data"
    if not data.is_dir():
        raise SystemExit(f"Original Data directory missing: {data}")
    assets = ROOT / "public/assets"
    runtime = ROOT / "public/original"
    if runtime.is_symlink():
        raise SystemExit("Refusing public/original symlink: only whitelist-copied Data may be served")
    assets.mkdir(parents=True, exist_ok=True)
    runtime.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    images = files = aliases = 0
    for source in sorted(data.rglob("*")):
        if not source.is_file() or source.is_symlink():
            continue
        extension = source.suffix.lower()
        relative = source.relative_to(args.source.resolve())
        key = relative.as_posix().lower()
        if extension in IMAGE_FORMATS:
            output_relative = relative.with_suffix(".png")
            output = assets / output_relative
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.exists() or output.stat().st_mtime < source.stat().st_mtime:
                with Image.open(source) as original:
                    # Preserve the original straight RGBA alpha, including atlas cutouts.
                    original.convert("RGBA").save(output)
            manifest[key] = "/assets/" + output_relative.as_posix()
            images += 1
            if "/overlay/textures/" in "/" + key:
                alias = assets / "original-ui" / (source.stem + ".png")
                alias.parent.mkdir(parents=True, exist_ok=True)
                if not alias.exists() or alias.stat().st_mtime < output.stat().st_mtime:
                    shutil.copy2(output, alias)
                aliases += 1
        elif extension in RUNTIME_FORMATS:
            output = runtime / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.exists() or output.stat().st_mtime < source.stat().st_mtime:
                shutil.copy2(source, output)
            manifest[key] = "/original/" + relative.as_posix()
            files += 1
    # The LND names musEquateur. Browser audio is a local derivative of this WAV.
    music_source = data / "Sound/Musics/musEquateur.wav"
    encoder = shutil.which("ffmpeg")
    if music_source.exists() and encoder:
        music_output = assets / "original-audio/musEquateur.mp3"
        music_output.parent.mkdir(parents=True, exist_ok=True)
        if not music_output.exists() or music_output.stat().st_mtime < music_source.stat().st_mtime:
            subprocess.run([
                encoder, "-hide_banner", "-loglevel", "error", "-y", "-i", str(music_source),
                "-codec:a", "libmp3lame", "-q:a", "4", str(music_output),
            ], check=True)
        manifest["data/sound/musics/musequateur.wav"] = "/assets/original-audio/musEquateur.mp3"
    elif music_source.exists():
        print("ffmpeg unavailable: original island music was not converted.")
    # The interface click referenced by Data/Sound/ParkSoundDB.ini is short and browser-safe as WAV.
    click_source = data / "Sound/Interface/select.wav"
    if click_source.exists():
        click_output = assets / "original-audio/select.wav"
        click_output.parent.mkdir(parents=True, exist_ok=True)
        if not click_output.exists() or click_output.stat().st_mtime < click_source.stat().st_mtime:
            shutil.copy2(click_source, click_output)
        manifest["data/sound/interface/select.wav"] = "/assets/original-audio/select.wav"
    (assets / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Prepared {images} original images, {aliases} UI atlas aliases, {files} runtime data files.")
    print(f"Case-insensitive path manifest: {assets / 'manifest.json'}")


if __name__ == "__main__":
    main()
