from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session


@dataclass
class ToolContext:
    db: Session
    session_id: str
    user_id: str
    turn_started_at: datetime
    suppress_check: bool = False
