"""Practice content and per-exercise settings, separate from session history."""

import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LickPracticePlan(BaseModel):
    start_bpm: int = Field(default=60, ge=20, le=300)
    step_bpm: int = Field(default=5, ge=1, le=100)
    beats_per_bar: int = Field(default=4, ge=1, le=16)
    subdivision: Literal[1, 2, 3, 4, 6] = 1
    loop_bars: int = Field(default=4, ge=1, le=128)
    rounds_per_step: int = Field(default=2, ge=1, le=32)
    auto_advance: bool = False
    bounce: bool = False


class LickBody(BaseModel):
    title: str = "Untitled"
    notes: str = ""
    target_bpm: float | None = Field(default=None, ge=20, le=300)
    collection: str = Field(default="", max_length=120)
    course_order: int | None = Field(default=None, ge=1, le=9999)
    status: Literal["active", "waiting", "maintenance", "archived"] = "active"
    tags: list[str] = Field(default_factory=list, max_length=30)
    score_images: list[str] = Field(default_factory=list, max_length=30)
    source_url: str = ""
    demo_url: str = ""
    pdf_url: str = ""
    reference_bpm_min: float | None = Field(default=None, ge=20, le=300)
    reference_bpm_max: float | None = Field(default=None, ge=20, le=300)
    practice_plan: LickPracticePlan | None = None
    # Free-form material board layout (web/licks-board.js); opaque to the server.
    layout: dict | None = None

    @field_validator("layout")
    @classmethod
    def layout_not_huge(cls, value):
        if value is not None and len(json.dumps(value)) > 100_000:
            raise ValueError("layout too large")
        return value

    @field_validator("score_images", "source_url", "demo_url", "pdf_url")
    @classmethod
    def safe_resource_urls(cls, value):
        urls = value if isinstance(value, list) else [value]
        if any(url and not url.startswith(("/api/", "https://", "http://")) for url in urls):
            raise ValueError("Use a material URL or an http(s) URL")
        return value


class LickTrainingUpdate(BaseModel):
    practice_plan: LickPracticePlan
    target_bpm: float | None = Field(default=None, ge=20, le=300)
