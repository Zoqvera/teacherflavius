#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANDROID_ROOT = ROOT / "android"
KEYSTORE_RELATIVE_PATH = Path("keystore") / "teacher-flavio-upload.jks"
SIGNING_PROPERTIES_RELATIVE_PATH = Path("keystore") / "signing.properties"
REQUIRED_ENVIRONMENT = (
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
)


def strip_matching_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"'}:
        return text[1:-1].strip()
    return text


def normalize_secret(name: str, raw_value: str) -> str:
    value = str(raw_value or "").strip()
    prefix = name + "="

    for line in value.splitlines():
        candidate = strip_matching_quotes(line)
        if candidate.startswith(prefix):
            return strip_matching_quotes(candidate[len(prefix):])

    candidate = strip_matching_quotes(value)
    if candidate.startswith(prefix):
        candidate = candidate[len(prefix):]
    return strip_matching_quotes(candidate)


def signing_environment() -> dict[str, str] | None:
    values = {
        name: normalize_secret(name, os.environ.get(name, ""))
        for name in REQUIRED_ENVIRONMENT
    }
    if not any(values.values()):
        return None

    missing = [name for name, value in values.items() if not value]
    if missing:
        raise SystemExit(
            "Android signing configuration is incomplete: "
            + ", ".join(missing)
        )
    return values


def decode_keystore(android_root: Path, encoded: str) -> Path:
    compact = "".join(encoded.split())
    try:
        payload = base64.b64decode(compact, validate=True)
    except Exception as exc:
        raise SystemExit("ANDROID_KEYSTORE_BASE64 is not valid base64.") from exc

    if len(payload) < 256:
        raise SystemExit("Decoded Android keystore is unexpectedly small.")

    path = android_root / KEYSTORE_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    path.chmod(0o600)
    return path


def escape_properties_value(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("=", "\\=")
        .replace(":", "\\:")
    )
    if escaped.startswith((" ", "#", "!")):
        escaped = "\\" + escaped
    return escaped


def write_signing_properties(
    android_root: Path,
    environment: dict[str, str],
) -> Path:
    path = android_root / SIGNING_PROPERTIES_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(
        (
            "storePassword="
            + escape_properties_value(environment["ANDROID_KEYSTORE_PASSWORD"]),
            "keyAlias=" + escape_properties_value(environment["ANDROID_KEY_ALIAS"]),
            "keyPassword="
            + escape_properties_value(environment["ANDROID_KEY_PASSWORD"]),
        )
    )
    path.write_text(content + "\n", encoding="utf-8")
    path.chmod(0o600)
    return path


def signing_config_block() -> str:
    return """
    def signingProperties = new Properties()
    signingProperties.load(
        new FileInputStream(rootProject.file("keystore/signing.properties"))
    )

    signingConfigs {
        release {
            storeFile rootProject.file("keystore/teacher-flavio-upload.jks")
            storePassword signingProperties.getProperty("storePassword")
            keyAlias signingProperties.getProperty("keyAlias")
            keyPassword signingProperties.getProperty("keyPassword")
        }
    }

"""


def configure_gradle(build_gradle: Path) -> None:
    content = build_gradle.read_text(encoding="utf-8")

    if "teacher-flavio-upload.jks" not in content:
        android_marker = "android {\n"
        if android_marker not in content:
            raise SystemExit("Could not locate the Android Gradle configuration block.")
        content = content.replace(
            android_marker,
            android_marker + signing_config_block(),
            1,
        )

    if "signingConfig signingConfigs.release" not in content:
        release_pattern = re.compile(
            r"(buildTypes\s*\{\s*release\s*\{\s*)",
            re.MULTILINE,
        )
        content, count = release_pattern.subn(
            r"\1            signingConfig signingConfigs.release\n",
            content,
            count=1,
        )
        if count != 1:
            raise SystemExit("Could not locate the Android release buildType.")

    build_gradle.write_text(content, encoding="utf-8")


def configure(android_root: Path) -> bool:
    environment = signing_environment()
    if environment is None:
        print("Android release signing: secrets not configured; release remains unsigned.")
        return False

    build_gradle = android_root / "app" / "build.gradle"
    if not build_gradle.is_file():
        raise SystemExit(f"Android app build file does not exist: {build_gradle}")

    decode_keystore(android_root, environment["ANDROID_KEYSTORE_BASE64"])
    write_signing_properties(android_root, environment)
    configure_gradle(build_gradle)
    print("Android release signing configured.")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Configure Android release signing from environment secrets."
    )
    parser.add_argument("--android-root", type=Path, default=DEFAULT_ANDROID_ROOT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    android_root = (
        args.android_root
        if args.android_root.is_absolute()
        else ROOT / args.android_root
    )
    configure(android_root.resolve())


if __name__ == "__main__":
    main()
