#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANDROID_ROOT = ROOT / "android"
DEFAULT_CONFIG = ROOT / "mobile" / "android_release.json"
ANDROID_NS = "http://schemas.android.com/apk/res/android"

ET.register_namespace("android", ANDROID_NS)


def android_attr(name: str) -> str:
    return "{" + ANDROID_NS + "}" + name


def load_config(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    required = ("applicationId", "versionCode", "versionName", "brand")
    missing = [key for key in required if key not in payload]
    if missing:
        raise SystemExit(f"Android release config is missing: {', '.join(missing)}")
    return payload


def parse_svg_paths(svg_path: Path) -> tuple[str, str, list[tuple[str, str]]]:
    root = ET.parse(svg_path).getroot()
    view_box = root.attrib.get("viewBox", "").split()
    if len(view_box) != 4:
        raise SystemExit("Brand SVG must define a four-value viewBox.")

    viewport_width = view_box[2]
    viewport_height = view_box[3]
    paths: list[tuple[str, str]] = []

    for node in root.iter():
        if not node.tag.endswith("path"):
            continue
        path_data = node.attrib.get("d", "").strip()
        fill = node.attrib.get("fill", "#FFFFFF").strip()
        if path_data:
            paths.append((path_data, fill))

    if not paths:
        raise SystemExit("Brand SVG does not contain path artwork.")

    return viewport_width, viewport_height, paths


def vector_xml(
    viewport_width: str,
    viewport_height: str,
    paths: list[tuple[str, str]],
    *,
    width_dp: int,
    height_dp: int,
    background: str | None = None,
) -> str:
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        f'    android:width="{width_dp}dp"',
        f'    android:height="{height_dp}dp"',
        f'    android:viewportWidth="{viewport_width}"',
        f'    android:viewportHeight="{viewport_height}">',
    ]

    if background:
        lines.append(
            f'    <path android:fillColor="{background}" '
            f'android:pathData="M0,0 H{viewport_width} V{viewport_height} H0 Z"/>'
        )

    for path_data, fill in paths:
        lines.append(
            f'    <path android:fillColor="{fill}" '
            f'android:pathData="{path_data}"/>'
        )

    lines.append("</vector>")
    return "\n".join(lines) + "\n"


def adaptive_icon_xml() -> str:
    return """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_teacher_flavio_foreground"/>
</adaptive-icon>
"""


def splash_layer_xml() -> str:
    return """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/teacher_flavio_navy"/>
    <item
        android:width="128dp"
        android:height="128dp"
        android:gravity="center"
        android:drawable="@drawable/ic_teacher_flavio_splash"/>
</layer-list>
"""


def colors_xml(background: str, accent: str, secondary: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="teacher_flavio_navy">{background}</color>
    <color name="teacher_flavio_accent">{accent}</color>
    <color name="teacher_flavio_secondary">{secondary}</color>
</resources>
"""


def launcher_background_xml(background: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{background}</color>
</resources>
"""


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def remove_generated_launcher_bitmaps(res_root: Path) -> None:
    for directory in res_root.glob("mipmap-*"):
        for pattern in ("ic_launcher*.png", "ic_launcher*.webp"):
            for path in directory.glob(pattern):
                path.unlink()


def remove_generated_splash_bitmaps(res_root: Path) -> None:
    for directory in res_root.glob("drawable*"):
        for path in directory.glob("splash.png"):
            path.unlink()


def replace_release_version(build_gradle: Path, config: dict) -> None:
    content = build_gradle.read_text(encoding="utf-8")

    version_code = int(config["versionCode"])
    version_name = str(config["versionName"])
    application_id = str(config["applicationId"])

    updated, code_count = re.subn(
        r"versionCode\s+\d+",
        f"versionCode {version_code}",
        content,
        count=1,
    )
    updated, name_count = re.subn(
        r'versionName\s+"[^"]+"',
        f'versionName "{version_name}"',
        updated,
        count=1,
    )

    if code_count != 1 or name_count != 1:
        raise SystemExit("Could not locate Android versionCode/versionName.")

    if application_id not in updated:
        raise SystemExit("Generated Android applicationId does not match release config.")

    build_gradle.write_text(updated, encoding="utf-8")


def configure_branding(android_root: Path, config: dict, root: Path) -> None:
    res_root = android_root / "app" / "src" / "main" / "res"
    brand = config["brand"]
    source_svg = root / str(brand["sourceSvg"])
    if not source_svg.is_file():
        raise SystemExit(f"Brand SVG was not found: {source_svg}")

    viewport_width, viewport_height, paths = parse_svg_paths(source_svg)
    background = str(brand["backgroundColor"])
    accent = str(brand["accentColor"])
    secondary = str(brand["foregroundSecondary"])

    remove_generated_launcher_bitmaps(res_root)
    remove_generated_splash_bitmaps(res_root)

    write_text(
        res_root / "drawable" / "ic_teacher_flavio_foreground.xml",
        vector_xml(
            viewport_width,
            viewport_height,
            paths,
            width_dp=108,
            height_dp=108,
        ),
    )
    write_text(
        res_root / "drawable" / "ic_teacher_flavio_splash.xml",
        vector_xml(
            viewport_width,
            viewport_height,
            paths,
            width_dp=128,
            height_dp=128,
        ),
    )
    write_text(
        res_root / "mipmap-anydpi" / "ic_launcher.xml",
        vector_xml(
            viewport_width,
            viewport_height,
            paths,
            width_dp=48,
            height_dp=48,
            background=background,
        ),
    )
    write_text(
        res_root / "mipmap-anydpi" / "ic_launcher_round.xml",
        vector_xml(
            viewport_width,
            viewport_height,
            paths,
            width_dp=48,
            height_dp=48,
            background=background,
        ),
    )
    write_text(
        res_root / "mipmap-anydpi-v26" / "ic_launcher.xml",
        adaptive_icon_xml(),
    )
    write_text(
        res_root / "mipmap-anydpi-v26" / "ic_launcher_round.xml",
        adaptive_icon_xml(),
    )
    write_text(
        res_root / "drawable" / "splash.xml",
        splash_layer_xml(),
    )
    write_text(
        res_root / "values" / "teacher_flavio_colors.xml",
        colors_xml(background, accent, secondary),
    )
    write_text(
        res_root / "values" / "ic_launcher_background.xml",
        launcher_background_xml(background),
    )


def configure(android_root: Path, config_path: Path, root: Path) -> None:
    if not android_root.is_dir():
        raise SystemExit(f"Android project does not exist: {android_root}")

    config = load_config(config_path)
    build_gradle = android_root / "app" / "build.gradle"
    if not build_gradle.is_file():
        raise SystemExit(f"Android app build file does not exist: {build_gradle}")

    replace_release_version(build_gradle, config)
    configure_branding(android_root, config, root)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply Teacher Flávio release metadata and Android branding."
    )
    parser.add_argument("--android-root", type=Path, default=DEFAULT_ANDROID_ROOT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    android_root = args.android_root if args.android_root.is_absolute() else ROOT / args.android_root
    config_path = args.config if args.config.is_absolute() else ROOT / args.config
    configure(android_root.resolve(), config_path.resolve(), ROOT)
    print("Android release metadata and branding configured.")


if __name__ == "__main__":
    main()
