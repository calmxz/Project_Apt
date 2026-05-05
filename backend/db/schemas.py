from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    status: str


class ChatRequest(BaseModel):
    user_id: str
    session_id: str
    message: str


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    assistant_message: str
    message_id: int
