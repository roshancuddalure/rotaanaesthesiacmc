"""Durable per-file regression receipts so interrupted audits retain terminal evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress/fairness-system'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def hashes():
    return {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT/'backend/app').rglob('*.py'))}


def main():
    OUT.mkdir(exist_ok=True)
    files = sorted((ROOT/'backend/tests').glob('test_*.py'))
    status = {'started_at':stamp(), 'status':'running', 'total_files':len(files), 'files':[]}
    # This runner is resumed explicitly; completed receipts are never overwritten.
    index = OUT/'status.json'
    if index.exists():
        status = json.loads(index.read_text(encoding='utf-8'))
    completed = {row['file'] for row in status['files']}
    for path in files:
        name = path.name
        if name in completed:
            continue
        source = hashes()
        status.update(status='running', current=name, updated_at=stamp())
        index.write_text(json.dumps(status,indent=2),encoding='utf-8')
        receipt = OUT/(path.stem+'.xml')
        log = OUT/(path.stem+'.log')
        with log.open('wb') as output:
            child = subprocess.Popen([sys.executable,'-m','pytest',str(path),'-q','--tb=short',
                                      f'--junitxml={receipt}'],cwd=ROOT,stdout=output,stderr=subprocess.STDOUT)
            status.update(worker_pid=child.pid)
            index.write_text(json.dumps(status,indent=2),encoding='utf-8')
            code = child.wait()
        result = dict(file=name, exit_code=code, finished_at=stamp(),
                      source_sha256=source, source_unchanged=source==hashes())
        if receipt.exists():
            suite = ET.parse(receipt).getroot().find('testsuite')
            result.update({k:suite.get(k) for k in ['tests','failures','errors','skipped','time']})
        status['files'].append(result)
        status.update(updated_at=stamp(),worker_pid=None)
        index.write_text(json.dumps(status,indent=2),encoding='utf-8')
    status.update(status='finished',current=None,updated_at=stamp())
    index.write_text(json.dumps(status,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
