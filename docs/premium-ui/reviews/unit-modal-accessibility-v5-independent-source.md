# Independent V5 source review: changes required

Reviewer: `/root/unit_focus_source_v5`. **Do not integrate V5 unchanged.** Source preservation and a fresh independent full-project TypeScript overlay pass, but a separately authored actual-app probe finds a focus-return defect in all six engine/width contexts.

Cancel a mouse gesture on Manage A by pressing there and releasing outside the cards. Then focus Manage B and press Enter. B opens correctly, but closing it with Escape returns focus to Manage A. The control case without the abandoned pointer gesture returns to B correctly. The stale gesture is only33–74ms old, so V5's1500ms candidate priority applies. This reproduces in Chromium, Firefox and WebKit at320 and1280px, with GET fixtures/local RAM and no writes.

The cause is in `rememberOpener`: the pointerdown candidate takes priority over active focus. Pointer state survives cancellation and is not invalidated by the newer keyboard action before the no-modal key-handler return. Commit the actual opening click before the existing delegated handler, or invalidate stale pointer state on newer keyboard intent. Preserve the working WebKit native-opener and card-title→Manage paths. The finding does not require a business-handler or API change.

The independent source check confirms candidate main differs only by one import and one shell-lifetime binding; reversing both exactly restores applied main. Existing mounts, delegated actions, request bodies, policy/storage code and forms remain unchanged. The helper has no network/storage/eval/timer calls. I inspected inert restoration, shell aborts, native/body-overlay stand-down and native-close BODY-only microtask recovery against the actual shell and workspace owners. Those bounded source checks are useful but do not override the concrete stale-pointer failure.

`unit-modal-accessibility-v5-independent-source.json` binds the sources, compile check, independent probe/test/log and root packets. The probe records a failure deliberately: its terminal0 means diagnostics completed, not that V5 is correct. Root's other45 candidate and six baseline contexts remain root evidence, not an independent replay by this reviewer. No application, candidate, backend, acceptance ledger or review archive was changed.

A revised candidate needs this counterexample rerun alongside the original native mouse/touch, card-title, native success/failure and abort/rerender checks, then source review before integration. Full260 acceptance, physical devices and native assistive technology remain outside this bounded review.
