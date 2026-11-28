"""Bounded in-process synthetic API bridge; opens no socket or service port."""
import argparse
import base64
import importlib.util
import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', choices=['weekend', 'leave', 'hours', 'quota', 'joint'], required=True)
    args = parser.parse_args()
    sys.argv.append({'weekend': '--weekends', 'leave': '--leave-overlap', 'hours': '--hours', 'quota': '--quota', 'joint': '--joint-nights'}[args.case])
    spec = importlib.util.spec_from_file_location('isolated_fairness_fixture', ROOT/'tools/serve_fairness_integration_fixture.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    assert fixture.engine.url.get_backend_name() == 'sqlite'
    assert fixture.engine.url.database == ':memory:'
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    with TestClient(fixture.app, base_url='http://127.0.0.1:5219') as client:
        for number, line in enumerate(sys.stdin):
            if number >= 2000:
                raise RuntimeError('Synthetic request budget exhausted')
            request = json.loads(line)
            assert request['path'].startswith('/') and not request['path'].startswith('//')
            response = client.request(request['method'], request['path'],
                headers=request.get('headers', {}), content=base64.b64decode(request.get('body', '')))
            headers = {k:v for k,v in response.headers.items()
                       if k.lower() not in {'content-length','content-encoding','transfer-encoding','connection'}}
            print(json.dumps({'id':request['id'], 'status':response.status_code,
                              'headers':headers, 'body':base64.b64encode(response.content).decode('ascii')}))
    fixture.engine.dispose()


if __name__ == '__main__':
    main()
