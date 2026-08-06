"""Request-id contextvar. The ASGI middleware that sets it lives below."""

from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
