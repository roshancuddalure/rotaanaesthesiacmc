"""Offline wrapper; no apply token, operational writes or release authority."""


def study(state, *, max_trials=128):
    from app.services.allocation_weekend import refine_weekends
    result = refine_weekends(state, max_trials=max_trials, record_moves=False)
    result['limitations'] += ' This offline study is not a server proposal and has no apply token.'
    return result
