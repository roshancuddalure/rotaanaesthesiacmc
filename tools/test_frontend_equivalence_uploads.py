import hashlib
import unittest

from frontend_equivalence_uploads import payload_snapshot


def multipart(data, boundary="fixture-boundary"):
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nappend\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="input.csv"\r\n'
            'Content-Type: text/csv\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    return f'multipart/form-data; boundary={boundary}', body


class UploadSnapshotTests(unittest.TestCase):
    def test_random_boundary_only_is_ignored(self):
        self.assertEqual(payload_snapshot(*multipart(b'a\r\nb\r\n', 'one')),
                         payload_snapshot(*multipart(b'a\r\nb\r\n', 'two')))

    def test_equal_length_different_contents_detected(self):
        self.assertNotEqual(payload_snapshot(*multipart(b'abc')), payload_snapshot(*multipart(b'abd')))

    def test_final_csv_newline_preserved(self):
        self.assertNotEqual(payload_snapshot(*multipart(b'abc\r\n')), payload_snapshot(*multipart(b'abc')))

    def test_unicode_and_null_bytes_hash_exactly(self):
        data = 'Name\r\nDr Jos\u00e9\r\n'.encode() + b'\0'
        result = payload_snapshot(*multipart(data))['parts'][1]
        self.assertEqual(result['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['bytes'], len(data))

    def test_plain_values_retained(self):
        self.assertEqual(payload_snapshot(*multipart(b'a'))['parts'][0], {'name': 'mode', 'value': 'append'})

    def test_json_keeps_zero_null_boolean(self):
        self.assertEqual(payload_snapshot('application/json', b'{"count":0,"none":null,"flag":false}')['value'],
                         {'count': 0, 'none': None, 'flag': False})

    def test_missing_boundary_rejected(self):
        with self.assertRaises(ValueError):
            payload_snapshot('multipart/form-data', b'not multipart')


if __name__ == '__main__':
    unittest.main()
