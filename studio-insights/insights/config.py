from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Area:
    key: str
    label: str
    keywords: list[str]
    capacity: int
    trainer_pay: float


@dataclass
class Config:
    raw: dict[str, Any]
    areas: dict[str, Area] = field(default_factory=dict)

    @property
    def studio_name(self) -> str:
        return self.raw.get("studio_name", "הסטודיו")

    @property
    def vat_rate(self) -> float:
        return float(self.raw.get("vat_rate", 0.18))

    @property
    def prices_include_vat(self) -> bool:
        return bool(self.raw.get("prices_include_vat", True))

    @property
    def fixed_costs(self) -> float:
        return float(sum(self.raw.get("fixed_costs", {}).values()))

    @property
    def alerts(self) -> dict[str, Any]:
        return self.raw.get("alerts", {})

    @property
    def cancellation(self) -> dict[str, Any]:
        return self.raw.get("cancellation", {"min_bookings": 2, "sandwich_pay": 80})

    def price(self, entries: int | None, student: bool) -> float | None:
        if entries is None:
            return None
        table = self.raw["prices"]["student" if student else "regular"]
        value = table.get(entries, table.get(str(entries)))
        if value is None and student:  # no student tier for this size -> regular price
            value = self.raw["prices"]["regular"].get(entries)
        return None if value is None else float(value)

    def net(self, gross: float) -> float:
        return gross / (1 + self.vat_rate) if self.prices_include_vat else gross

    def area_of(self, class_name: str) -> str | None:
        for area in self.areas.values():
            if any(k in str(class_name) for k in area.keywords):
                return area.key
        return None


def load_config(path: str | Path | None = None) -> Config:
    path = Path(path) if path else ROOT / "config.yaml"
    if not path.exists():
        path = ROOT / "config.example.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    areas = {
        key: Area(key=key, label=a["label"], keywords=a["keywords"],
                  capacity=int(a["capacity"]), trainer_pay=float(a["trainer_pay"]))
        for key, a in raw["areas"].items()
    }
    return Config(raw=raw, areas=areas)
