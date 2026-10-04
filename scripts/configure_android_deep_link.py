#!/usr/bin/env python3
from __future__ import annotations

import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID_NS = "http://schemas.android.com/apk/res/android"
APP_SCHEME = "com.teacherflavius.app"
CALLBACK_HOST = "login-callback"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"

ET.register_namespace("android", ANDROID_NS)


def android_attr(name: str) -> str:
    return "{" + ANDROID_NS + "}" + name


def is_oauth_filter(intent_filter: ET.Element) -> bool:
    data = intent_filter.find("data")
    if data is None:
        return False
    return (
        data.get(android_attr("scheme")) == APP_SCHEME
        and data.get(android_attr("host")) == CALLBACK_HOST
    )


def create_oauth_filter() -> ET.Element:
    intent_filter = ET.Element("intent-filter")

    action = ET.SubElement(intent_filter, "action")
    action.set(android_attr("name"), "android.intent.action.VIEW")

    default_category = ET.SubElement(intent_filter, "category")
    default_category.set(android_attr("name"), "android.intent.category.DEFAULT")

    browsable_category = ET.SubElement(intent_filter, "category")
    browsable_category.set(android_attr("name"), "android.intent.category.BROWSABLE")

    data = ET.SubElement(intent_filter, "data")
    data.set(android_attr("scheme"), APP_SCHEME)
    data.set(android_attr("host"), CALLBACK_HOST)
    return intent_filter


def configure_manifest(path: Path) -> bool:
    if not path.is_file():
        raise SystemExit(f"Android manifest does not exist: {path}")

    tree = ET.parse(path)
    root = tree.getroot()
    activity = root.find(
        ".//activity[@android:name='.MainActivity']",
        {"android": ANDROID_NS},
    )
    if activity is None:
        raise SystemExit("MainActivity was not found in AndroidManifest.xml")

    if any(is_oauth_filter(item) for item in activity.findall("intent-filter")):
        return False

    activity.append(create_oauth_filter())
    ET.indent(tree, space="    ")
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Register the Teacher Flávio OAuth callback in Android."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    path = args.manifest if args.manifest.is_absolute() else ROOT / args.manifest
    changed = configure_manifest(path.resolve())
    state = "configured" if changed else "already configured"
    print(f"Android OAuth deep link: {state}.")


if __name__ == "__main__":
    main()
