# Visible generation entry controls

Run `node tests/premium-generation-launchers.browser.mjs` from `frontend` with
the production preview on5198 and dedicated disposable RAM API on8032. Run alone
against8032; the suite resets and prepares four unassigned template slots per
context through existing API services.

Chromium, Firefox and WebKit at320/1280 verify that visible keyboard activation
opens the template generator, Autoassign chooser and whole-month optimiser for
May2026. Each dialog closes cleanly. Browser API traffic is GET-only; attempts
to mutate are blocked and fail the test. Exact saved-state read-back must match.
The actual source/public/dist files remain held.

This covers the fixture computer-admin role, draft month and loaded toolbar.
It does not cover early-loading controls, every permission/denial state,
submitting these dialogs, physical devices or native assistive technology.
Generation submission and saved outcomes are separate equivalence workflows.
