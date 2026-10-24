"""Negative controls for full-wave scope and fresh accessibility QA outputs."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from run_frontend_accessibility_recovery import (
    ENDPOINTS, REPORTS, SUITES, check_report_file, suite_environment,
    validate_report, wave_passed,
)


class AccessibilityRunnerTests(unittest.TestCase):
    def test_inherited_subset_baseline_probe_and_redirects_removed(self):
        inherited = {'PATH': 'preserved', 'SystemRoot': 'preserved',
                     'PREMIUM_RECOVERY_CASE': 'nonexistent',
                     'PREMIUM_RECOVERY_PRODUCTION': '1', 'PREMIUM_PROBE': '1',
                     'STYLE_BASELINE': '1', 'EQUIVALENCE_IMPORT_MODES': '1',
                     'MEMBER_TEST_ENGINE': 'chromium', 'premium_subset': 'one',
                     'PREMIUM_TEST_API': 'https://unintended.invalid',
                     'UX_AUDIT_API': 'https://unintended.invalid'}
        result = suite_environment(inherited)
        self.assertEqual(result, {'PATH': 'preserved', 'SystemRoot': 'preserved', **ENDPOINTS})
        self.assertEqual(inherited['PREMIUM_PROBE'], '1', 'Caller environment must remain unchanged')

    def test_explicit_suite_override_is_honored(self):
        self.assertEqual(suite_environment({}, {'PREMIUM_PROBE': '1'})['PREMIUM_PROBE'], '1')

    def recovery_report(self):
        return {'results': [{'name': f'scenario {index}', 'passed': True} for index in range(6)], 'skipped': []}

    def test_complete_report_allowed(self):
        self.assertEqual(validate_report('request-and-bootstrap-recovery', self.recovery_report()), 6)

    def test_zero_or_subset_results_rejected(self):
        for count in (0, 1, 5, 7):
            report = self.recovery_report()
            report['results'] = [{'name': str(i), 'passed': True} for i in range(count)]
            with self.subTest(count=count), self.assertRaises(ValueError):
                validate_report('request-and-bootstrap-recovery', report)

    def test_duplicate_scenarios_rejected(self):
        report = self.recovery_report()
        report['results'][1] = copy.deepcopy(report['results'][0])
        with self.assertRaises(ValueError):
            validate_report('request-and-bootstrap-recovery', report)

    def test_skips_false_or_missing_pass_rejected(self):
        for change in ('skipped', 'failed', 'missing'):
            report = self.recovery_report()
            if change == 'skipped':
                report['skipped'] = ['request client']
            elif change == 'failed':
                report['results'][0]['passed'] = False
            else:
                del report['results'][0]['passed']
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_report('request-and-bootstrap-recovery', report)

    def test_unsupported_or_missing_selection_cue_rejected(self):
        report = {'results': [{'engine': str(i), 'scheme': 'light', 'width': 320,
                               'status': 'supported_bounded_outcomes', 'selected_visual_cue': True,
                               'keyboard_selected_panel': True} for i in range(12)]}
        self.assertEqual(validate_report('forced-color-selection', report), 12)
        for key, value in [('status', 'forced_colors_not_emulated'), ('selected_visual_cue', False), ('runtime_pass', False)]:
            changed = copy.deepcopy(report)
            changed['results'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_report('forced-color-selection', changed)

    def test_stylesheet_baseline_or_missing_healthy_controls_rejected(self):
        report = {'results': [{'engine': engine, 'width': width, 'guardedReload': True,
                               'keepWorkingPreservesApp': True, 'lateFailuresDeduplicated': True}
                              for engine in ('chromium', 'firefox', 'webkit') for width in (320, 1280)],
                  'healthy': [{'engine': engine, 'noFalseWarning': True}
                              for engine in ('chromium', 'firefox', 'webkit')]}
        self.assertEqual(validate_report('stylesheet-recovery', report), 6)
        for change in ('baseline', 'healthy'):
            changed = copy.deepcopy(report)
            if change == 'baseline':
                changed['results'][0]['guardedReload'] = False
            else:
                changed['healthy'].pop()
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_report('stylesheet-recovery', changed)

    def test_runtime_errors_or_malformed_output_rejected(self):
        report = self.recovery_report()
        report['results'][0]['page_errors'] = ['uncaught']
        for changed in (report, [], {'results': [None] * 6}):
            with self.subTest(report=changed), self.assertRaises(ValueError):
                validate_report('request-and-bootstrap-recovery', changed)

    def test_stale_report_rejected_even_when_green(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'report.json'
            path.write_text(json.dumps(self.recovery_report()), encoding='utf-8')
            stamp = path.stat().st_mtime_ns
            with self.assertRaises(ValueError):
                check_report_file('request-and-bootstrap-recovery', path, stamp, stamp - 1)
            with self.assertRaises(ValueError):
                check_report_file('request-and-bootstrap-recovery', path, None, stamp + 1)
            self.assertEqual(check_report_file('request-and-bootstrap-recovery', path, None, stamp - 1), 6)

    def test_wave_requires_every_suite_and_held_inputs(self):
        rows = [{'family': family, 'exit_code': 0, 'test_inputs_held': True,
                 'report_validated': True, 'timed_out': False} for family in SUITES]
        self.assertTrue(wave_passed({'a': 'hash'}, {'a': 'hash'}, rows))
        self.assertFalse(wave_passed({}, {}, rows[:-1]))
        self.assertFalse(wave_passed({'a': 'old'}, {'a': 'new'}, rows))
        for key, value in [('exit_code', 1), ('test_inputs_held', False), ('report_validated', False), ('timed_out', True)]:
            changed = copy.deepcopy(rows)
            changed[0][key] = value
            with self.subTest(key=key):
                self.assertFalse(wave_passed({}, {}, changed))

    def test_current_eight_report_contracts(self):
        # Read-only schema/count check; does not represent a fresh browser run.
        root = Path(__file__).resolve().parents[1] / 'docs/premium-ui'
        for family, (filename, count, _) in REPORTS.items():
            with self.subTest(family=family):
                report = json.loads((root / filename).read_text(encoding='utf-8'))
                self.assertEqual(validate_report(family, report), count)


if __name__ == '__main__':
    unittest.main()
