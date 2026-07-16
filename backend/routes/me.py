"""Account-level user state (F-46): onboarding + preferences live on the
users row, not per-browser localStorage. A new device hydrates from here."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from contracts import MePatchRequest, MeResponse
from db.database import get_db
from services.auth import accepted_terms_from_request, current_user_id
from services.user_service import ensure_user


router = APIRouter(prefix="/api")


def _to_response(user) -> MeResponse:
    return MeResponse(
        display_name=user.display_name,
        feedback_pref=user.feedback_pref,
        onboarding_complete=bool(user.onboarding_complete),
    )


@router.get("/me", response_model=MeResponse)
def get_me(
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    user = ensure_user(
        db, user_id, accepted_terms=accepted_terms_from_request(request)
    )
    db.commit()
    return _to_response(user)


@router.patch("/me", response_model=MeResponse)
def patch_me(
    req: MePatchRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    # Codegen drops the openapi `minProperties: 1` constraint (contracts are
    # generated, not hand-tunable) -- enforce the empty-patch rejection here,
    # same pattern as routes/profile.py's patch_profile empty-patch guard.
    if (
        req.display_name is None
        and req.feedback_pref is None
        and req.onboarding_complete is None
    ):
        raise HTTPException(status_code=422, detail="empty patch")

    user = ensure_user(
        db, user_id, accepted_terms=accepted_terms_from_request(request)
    )
    if req.display_name is not None:
        user.display_name = req.display_name.strip() or None
    if req.feedback_pref is not None:
        user.feedback_pref = req.feedback_pref
    if req.onboarding_complete is not None:
        user.onboarding_complete = req.onboarding_complete
    db.commit()
    db.refresh(user)
    return _to_response(user)
