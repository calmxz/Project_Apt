from fastapi import APIRouter

from contracts import HealthResponse

router = APIRouter()


def _ok() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health", response_model=HealthResponse)
def health():
    return _ok()


@router.get("/healthz", response_model=HealthResponse, include_in_schema=False)
def healthz():
    return _ok()
