Diagnostics visual review, 22 October 2026

Inspected the actual-app Chromium full-page captures at 320 and 1280 CSS pixels in both light and dark themes. The final captures show distinct returned-count sections, readable count columns, wrapped long unknown category labels, visible zero values, and accessible native support disclosures. The desktop cards retain their content height rather than stretching a short section to the height of the long database category list.

Captures: diagnostics-320-light.png, diagnostics-320-dark.png, diagnostics-1280-light.png, diagnostics-1280-dark.png. These show injected summary data and injected clipboard success/failure notifications. Raw JSON is collapsed in these captures; its keyboard expansion, complete text, exact clipboard argument and failure selection were exercised by the accompanying 12-case browser suite. Selection comparison normalizes browser-generated Windows CRLF line endings; the JSON text and clipboard API argument are compared byte for byte without normalization.

No physical device, screen-reader, native OS clipboard or backend diagnostic correctness claim. The current source hashes and case results are in report.json. No API mutations were permitted in this test.
