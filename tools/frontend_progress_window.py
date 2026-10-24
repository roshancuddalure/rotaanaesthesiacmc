"""Read-only loopback progress window; independent of the rota app and its database."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs' / 'premium-ui'

def read(name):
    return json.loads((DOCS / name).read_text(encoding='utf-8'))

def snapshot():
    ledger = read('traceability.json')
    audit = read('acceptance-audit-current.json')
    verification = read('verification-current.json')
    live = read('live-work.json') if (DOCS / 'live-work.json').exists() else {}
    batches = []
    for entry in audit.get('additional_bounded_batches', [])[-16:][::-1]:
        relative = entry.get('report', '')
        target = (ROOT / relative).resolve()
        if not target.is_relative_to((DOCS / 'reviews').resolve()) or target.suffix != '.json':
            continue
        if target.is_file():
            review = json.loads(target.read_text(encoding='utf-8'))
            batches.append({'title': target.stem.replace('-current', '').replace('-', ' '),
                           'recorded_at': entry.get('recorded_at_utc'), 'scope': review.get('scope', entry.get('scope', '')),
                           'checks': review.get('checks', {}), 'evidence': relative,
                           'limitations': review.get('limitations', [])})
    items = []
    for item in ledger['items']:
        evidence = list(dict.fromkeys(p for f in item.get('followups', []) for p in f.get('evidence', [])))
        items.append({'id': item['item_id'], 'requirement': item['requirement'],
                      'status': item['implementation_status'], 'reviews': {k: v.get('status', 'pending') for k,v in item.get('reviews', {}).items()},
                      'evidence': evidence[-8:], 'followups': len(item.get('followups', [])),
                      'limitations': item.get('limitations', [])})
    return {'read_at': datetime.now(timezone.utc).isoformat(), 'ledger_recorded_at': verification.get('recorded_at_utc'),
            'counts': dict(Counter(i['status'] for i in items)), 'total': len(items),
            'certified': audit.get('counts', {}).get('whole_requirement_completion_proven', 0),
            'live': live, 'batches': batches, 'items': items,
            'unit_tests': verification.get('current_unit_tests', {}), 'build': verification.get('build', {}),
            'snapshot_note': verification.get('snapshot_note', ''),
            'scope': verification.get('scope', ''), 'physical': 'Pending — browser emulation selected by you'}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # No arbitrary filesystem paths, directory listing, API proxy, credentials or writes.
        if self.path in ('/', '/index.html'):
            body = (DOCS / 'progress-window.html').read_bytes()
            content_type = 'text/html; charset=utf-8'
        elif self.path == '/progress.json':
            try:
                body = json.dumps(snapshot(), ensure_ascii=False).encode('utf-8')
            except (OSError, ValueError, KeyError, TypeError):
                self.send_error(503, 'Progress files are updating; retry shortly')
                return
            content_type = 'application/json; charset=utf-8'
        elif self.path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        else:
            self.send_error(404); return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def log_message(self, *_):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5199)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Frontend progress window: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
