"""Disabled OT validation must not initialize the optional capacity solver."""
from pathlib import Path
import subprocess
import sys


def test_disabled_ot_validation_does_not_import_capacity_solver():
    # Fresh interpreter is necessary: the normal test process imports OT helpers
    # during collection, masking first-preview initialization overhead.
    code = '''
import sys
from app.core.config import settings
from tests import test_extra_duty as fixture
from app.services.rota_assignment import validate_assignment
settings.ot_calendar_enabled = False
owner = fixture.db.__wrapped__()
db = next(owner)
try:
    person, _, slot = fixture.two_person_unit(db)
    result = validate_assignment(db, slot=slot, person=person, replace_existing=False)
    assert 'ot_protection' not in result
finally:
    owner.close()
assert 'app.services.ot_capacity' not in sys.modules
assert 'app.services.ot_assignment_guard' not in sys.modules
'''
    result = subprocess.run([sys.executable, '-c', code],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
