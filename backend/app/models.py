from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Level = Literal["low", "medium", "high"]


class TaskInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    minutes: int = Field(ge=1, le=1440)
    deadline: date | None = None
    priority: Level = "medium"
    concentration: Level = "medium"
    place: str = Field(default="", max_length=80)


class Task(TaskInput):
    model_config = ConfigDict(extra="ignore")
    id: int
    completed: bool


class TaskStatus(BaseModel):
    completed: bool


class Condition(BaseModel):
    level: Literal["good", "normal", "tired"]


class SuggestionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    available_minutes: int = Field(ge=1, le=1440)
    place: str = Field(default="", max_length=80)
    use_calendar: bool = False


class AIChoice(BaseModel):
    task_id: int
    reason: str = Field(min_length=1, max_length=500)


class AIResult(BaseModel):
    choices: list[AIChoice] = Field(max_length=3)
    rest_reason: str = Field(min_length=1, max_length=500)
