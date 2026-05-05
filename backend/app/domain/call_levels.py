from pydantic import BaseModel


class CallLevel(BaseModel):
    key: str
    label: str
    rank: int
    is_special_posting: bool = False


CALL_LEVELS: tuple[CallLevel, ...] = (
    CallLevel(key="CO_1ST_CALL", label="Co-1st Call", rank=0),
    CallLevel(key="1ST_CALL", label="1st Call", rank=1),
    CallLevel(key="2ND_CALL", label="2nd Call", rank=2),
    CallLevel(key="3RD_CALL", label="3rd Call", rank=3),
    CallLevel(key="CO_4TH_CALL", label="Co-4th Call", rank=4),
    CallLevel(key="4TH_CALL", label="4th Call", rank=5),
    CallLevel(key="5TH_CALL", label="5th Call", rank=6),
    CallLevel(key="PAIN_CALL", label="Pain Call", rank=-1, is_special_posting=True),
    CallLevel(key="PAC_POSTING", label="PAC Posting", rank=-1, is_special_posting=True),
    CallLevel(key="SICU_POSTING", label="SICU Posting", rank=-1, is_special_posting=True),
    CallLevel(key="ICU_POSTING", label="ICU Posting", rank=-1, is_special_posting=True),
    CallLevel(key="DRP_POSTING", label="DRP Posting", rank=-1, is_special_posting=True),
    CallLevel(key="NEURO_ICU", label="Neuro ICU", rank=-1, is_special_posting=True),
)

