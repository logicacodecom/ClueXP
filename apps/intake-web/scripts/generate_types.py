from __future__ import annotations

import inspect
import sys
from pathlib import Path
from typing import get_args, get_origin

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api import schema


OUT = ROOT / "src" / "types" / "schema.generated.ts"


def ts_type(annotation: object) -> str:
    if annotation is type(None):
        return "null"
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is list:
        return f"{ts_type(args[0])}[]"
    if origin is None:
        if annotation in (str,):
            return "string"
        if annotation in (int, float):
            return "number"
        if annotation is bool:
            return "boolean"
        if annotation.__class__.__name__ == "EnumType":
            return annotation.__name__
        if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
            return annotation.__name__
        return "unknown"
    if str(origin).endswith("UnionType") or origin is getattr(__import__("typing"), "Union"):
        return " | ".join(ts_type(arg) for arg in args)
    if origin is object:
        return "unknown"
    return "unknown"


lines = [
    "/* eslint-disable */",
    "// Generated from api/schema.py by scripts/generate_types.py.",
    "// Do not edit by hand.",
    "",
]

for _, enum_cls in inspect.getmembers(schema, lambda obj: inspect.isclass(obj) and obj.__class__.__name__ == "EnumType"):
    if enum_cls.__module__ != "api.schema":
        continue
    values = " | ".join(f'"{item.value}"' for item in enum_cls)
    lines.append(f"export type {enum_cls.__name__} = {values};")

lines.append("")

for _, model_cls in inspect.getmembers(schema, lambda obj: inspect.isclass(obj) and issubclass(obj, BaseModel)):
    if model_cls.__module__ != "api.schema":
        continue
    lines.append(f"export interface {model_cls.__name__} {{")
    for field_name, field in model_cls.model_fields.items():
        optional = "?" if not field.is_required() else ""
        field_type = ts_type(field.annotation).replace("NoneType", "null")
        if "datetime" in str(field.annotation).lower() or "UUID" in str(field.annotation):
            field_type = "string"
        lines.append(f"  {field_name}{optional}: {field_type};")
    lines.append("}")
    lines.append("")

lines.extend(
    [
        "export interface TicketGuards {",
        "  may_show_technician: boolean;",
        "  may_show_eta: boolean;",
        "  may_show_live_tracking: boolean;",
        "}",
        "",
        "export interface TicketEnvelope {",
        "  ticket: Ticket;",
        "  guards: TicketGuards;",
        "}",
    ]
)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines), encoding="utf-8")
