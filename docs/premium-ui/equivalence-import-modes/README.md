# CSV import mode equivalence

This extends the fresh import comparison with nine sequential imports per UI run:

1. Member create-only: one new member included, one excluded.
2. Leave append: one new leave included, one excluded.
3. Unit append: post the new member; exclude an overlapping posting.
4. Member update-existing: change one default call level; exclude another member.
5. Member roster sync: update the included member and explicitly select one missing
   member to archive. Unticked missing members stay active, and history is retained.
6. Leave update-matching: change the unique included leave's end date and status.
7. Unit update-matching: extend only the unique included posting.
8. Leave replace-month: replace imported May leave, preserving manual leave and
   dates outside May. A spanning imported interval splits into April and June.
9. Unit replace-month: replace May board postings, preserving earlier/later dates
   and splitting spanning intervals. Excluded replacement rows are never created.

Every import previews without saving. Operational exclusions survive refresh.
Every native Apply confirmation is first declined (no request/save/callback), then
explicitly accepted. Replacement is also attempted before scope acknowledgement:
it must send no Apply request. Exact received upload hashes and plain field strings,
Apply bodies, statuses and saved semantics compare between frontends.

The full report must contain Chromium, Firefox and WebKit at both 320 and 1280
pixels. Generated preview IDs are mapped only from observed responses. New record
primary keys and creation timestamps are outside semantic-state comparison. The
captured baseline manifest and original/current/backend source hashes are checked.

This is a synthetic fixture, not full equivalence acceptance. Other roles, ambiguous
names, corrections, formats, large files, all export reports and production locking
remain outside scope. The test-only RAM server serializes requests; app/backend
sources are unchanged. Preliminary failure screenshots are diagnostic history.

Use the same server/proxy setup as [the basic import run](../equivalence-import/README.md).
Run only one suite against the RAM fixture at a time. From current `frontend`:

```powershell
$env:EQUIVALENCE_IMPORT_MODES='1'
node tests/premium-import-equivalence.browser.mjs
```

`EQUIVALENCE_QUICK=1` limits execution to one desktop pair and cannot replace the full
matrix. Reports and individual run artifacts are written to this directory.
