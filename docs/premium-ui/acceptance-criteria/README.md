# Requirement-specific acceptance definitions

The three specialist files preserve all260 numbered requirements from the
approved plan. They define521 concrete pass conditions, required evidence,
existing evidence candidates and remaining gaps. Historical timing exceptions
and conditional applicability are explicit. Physical and native-assistive-
technology checks retain their separately recorded pending dispositions.

`index.json` binds the exact plan and definition-file hashes and links every
numbered requirement to its criteria. Each ledger item has an
`acceptance_definition` reference. These are definitions, not passing results:
neither file existence nor a matching source hash certifies a requirement.

Run `python tools/verify_frontend_acceptance_criteria.py` to verify the complete
sequence, verbatim requirement text, condition structure, candidate paths and
index freshness. After reviewing intended definition changes, regenerate with
`--write-index`. This tool never changes implementation or review statuses.

Keep documentary/definition acceptance distinct from runtime UI acceptance.
For example, defining a typography scale needs direct token/specification proof;
it does not require every application action to pass. Conversely, a recoverable
editor requires actual scoped failure/retry outcomes; a component specification
or candidate link cannot substitute for them. Preserve the full original scope
and evaluate each condition before recording a completion decision.
