from fastapi.testclient import TestClient


class ReviewedImportClient(TestClient):
    """Existing import scenarios follow the new preview/apply contract automatically.

    Security/stale-state regressions use the ordinary TestClient to inspect failures.
    """
    def post(self, url, **kwargs):
        if (('/leave/import-apply' in str(url) or '/unit-management/import-apply' in str(url))
                and 'preview_hash' not in (kwargs.get('data') or {})):
            preview = super().post(str(url).replace('import-apply', 'import-preview'), **kwargs)
            if preview.status_code == 200:
                kwargs['data'] = {**(kwargs.get('data') or {}), 'preview_hash': preview.json()['preview_hash']}
        return super().post(url, **kwargs)
