# Shareable diagnostics

The diagnostics endpoint and its permissions remain unchanged. The frontend
constructs a presentation for the page and its existing Copy JSON control.
It does not export the arbitrary response object.

The presentation includes the reported generation timestamp, database record
counts, mapping/warning/period categories, account counts by role, invalid-name
count and invalid-name rule count. Zero remains zero. Missing, malformed or
nonfinite counts are marked unreported. Counts are neither recomputed nor summed.

Known technical category labels remain readable. Each unfamiliar category gets
an anonymous label within its group, retaining its exact numeric value and
position. This is necessary because a future category label could contain a
stored name, email or credential. The page explains the withholding. Anonymous
labels are positions in one response, not stable identifiers across refreshes.

Rule text, member records, credentials, pairing data and all unsupported fields
are excluded from visible technical details and copied JSON. A privacy marker
describes these exclusions. Timestamp text must have an ISO timestamp shape and
valid calendar/time components. Read errors use fixed safe copy with an explicit
retry, rather than rendering arbitrary diagnostic error details.

The browser clipboard receives only the displayed shareable JSON. If copying
fails, the same text remains available for manual selection. Pending copy
disables repeated activation. Late results cannot announce feedback or select
text in an obsolete route/session. A newer focus or pointer interaction prevents
fallback focus changes; closing the disclosure keeps its text hidden. The
original connected copy control is released even if a same-account profile
update replaces the account object while copying.

The before probe uses deliberately synthetic private markers. It establishes a
missing defensive frontend boundary in an arbitrary future response, not an
observed production leak. Tests of a synthetic clipboard do not certify the
operating system clipboard, native assistive technology or physical devices.
No API, backend, scheduling, persisted-data or operational export format changes
are part of this presentation update.
