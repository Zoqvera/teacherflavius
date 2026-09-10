#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScriptDependencySpec:
    dependency_src: str
    dependency_filename: str
    target_filename: str
    validation_message: str
    require_current_src: bool = False
