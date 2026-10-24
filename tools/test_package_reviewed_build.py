"""Negative controls for sealing already-reviewed frontend asset bytes."""
from copy import deepcopy
import unittest

from package_frontend_review import check_reviewed_build


class ReviewedBuildTests(unittest.TestCase):
    def setUp(self):
        self.sources = {'frontend/src/example.ts': 'a' * 64}
        self.assets = {'frontend/dist/index.html': 'b' * 64}
        self.proof = {'build_exit_code': 0, 'inputs_unchanged_during_build': True,
                      'source_hashes_before': deepcopy(self.sources),
                      'source_hashes_after': deepcopy(self.sources),
                      'artifacts': deepcopy(self.assets)}

    def test_exact_successful_snapshot_allowed(self):
        check_reviewed_build(self.proof, self.sources, self.assets)

    def test_failed_build_rejected(self):
        self.proof['build_exit_code'] = 1
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, self.sources, self.assets)

    def test_unheld_build_rejected(self):
        self.proof['inputs_unchanged_during_build'] = False
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, self.sources, self.assets)

    def test_changed_source_rejected(self):
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, {**self.sources, 'frontend/src/new.ts': 'c' * 64}, self.assets)

    def test_changed_asset_rejected(self):
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, self.sources, {'frontend/dist/index.html': 'c' * 64})

    def test_extra_asset_rejected(self):
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, self.sources, {**self.assets, 'frontend/dist/extra.js': 'c' * 64})

    def test_missing_or_empty_artifacts_rejected(self):
        with self.assertRaises(ValueError):
            check_reviewed_build(self.proof, self.sources, {})


if __name__ == '__main__':
    unittest.main()
