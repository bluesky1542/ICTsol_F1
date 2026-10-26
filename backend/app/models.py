from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Level = Literal["low", "medium", "high"]
ConditionLevel = Literal["good", "slightly_good", "normal", "slightly_tired", "tired"]


class TaskInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    minutes: int = Field(ge=1, le=1440)
    # 日本時間の締切。「YYYY-MM-DD」（その日中）または「YYYY-MM-DDTHH:MM」。
    deadline: str | None = None
    priority: Level = "medium"
    concentration: Level = "medium"
    place: str = Field(default="", max_length=80)

    @field_validator("deadline")
    @classmethod
    def valid_deadline(cls, value):
        if value is None or value == "":
            return None
        try:
            if len(value) == 10:
                return date.fromisoformat(value).isoformat()
            if len(value) == 16 and value[10] == "T":
                return datetime.strptime(value, "%Y-%m-%dT%H:%M").strftime("%Y-%m-%dT%H:%M")
        except ValueError:
            pass
        raise ValueError("締切は YYYY-MM-DD または YYYY-MM-DDTHH:MM の実在する日時で入力してください。")


class Task(TaskInput):
    model_config = ConfigDict(extra="ignore")
    id: int
    completed: bool


class TaskStatus(BaseModel):
    completed: bool


class Condition(BaseModel):
    level: ConditionLevel


class ReflectionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    achievement: Literal["done", "partial", "not_done"]
    satisfaction: int = Field(ge=1, le=5)
    tiredness: ConditionLevel
    comment: str = Field(default="", max_length=200)


class WorkPlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # 日本時間の HH:MM（00:00〜23:59）
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class ActivityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: int | None = Field(ge=1)


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
