# Requirement 159: dependent-refresh gap map

Keep requirement 159 partial. Eighteen new checks passed against the applied record guard: six registry and twelve posting/leave save cases across three browsers at phone and desktop widths.

The registry test confirms one saved PUT, a failed dependent read, preserved new unsaved name/notes, unchanged search/campus filters, and a manual GET-only retry showing the saved name. Record tests confirm one Save, dependent read failure, manual GET-only retry, and retained unit search/campus or Leave Day list mode.

The remaining work is specific: test post-Apply import read failure while a new import draft is present; reproduce monthly-approval parent ownership under a late response; reproduce admin-deletion parent ownership under a late response. The latter two are source concerns until actual outcomes prove a defect. Leave cancellation already has an explicit ownership guard and remains a guarded control.

The JSON packet maps each workflow to both original conditions and preserves exact test/report/log hashes. Its attribution addendum corrects an inherited record-test scope sentence without rewriting passed artifacts. No product or ledger change was made.
