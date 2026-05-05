import litellm

from config import settings


async def run(messages: list[dict], system_prompt: str) -> str:
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    response = await litellm.acompletion(
        model=settings.model,
        messages=full_messages,
        tools=None,
    )
    return response.choices[0].message.content
