# Royal frontend visual contract

This records the current implementation of the user's approved royal visual direction. The user approved frontend upgrades and protection of existing functionality; exact token values below are implementation choices, not a separate claim of user sign-off. This baseline is recorded after implementation and does not retroactively prove that every visual contract was frozen before broad styling began.

## Palette and meaning

`frontend/src/premium-theme.css` is the presentation token authority loaded after legacy section styles. Royal navy frames the sidebar and dialog headers; light content surfaces remain light in the light theme. Violet identifies primary actions and focus. Champagne is reserved for identity/decorative detail. Warning, failure, success and informational text use their separate semantic token families and explicit textual labels.

| Purpose | Light-theme token baseline | Constraint |
| --- | --- | --- |
| Navigation framing | `--color-sidebar: #171d38` | Do not apply navy indiscriminately to content panels. |
| Primary action | `--color-primary: #493a8f` | Keep review, Apply and Publish distinctions in their existing labels and gates. |
| Decorative accent | `--royal-champagne: #b99046` | Do not use decoration as the only warning indicator. |
| Main text/surface | `#20243b` / `#ffffff` | Long values wrap; empty data is not replaced with invented zeroes. |
| Success text/background | `#145d3e` / `#e6f5ed` | Retain authoritative returned success state and confirmed-save boundaries. |
| Warning text/background | `#76500d` / `#fff5dc` | Keep warning text independent of color. |
| Failure text/background | `#a1223a` / `#fcebf0` | Do not turn a timeout into a cancellation/rollback claim. |

The dark theme overrides semantic values in the same stylesheet. A light-theme contrast pass does not certify dark, hover, focus, disabled, transition or forced-color states. The recorded recycle-control transition fix illustrates why each state needs actual checks.

The sidebar gradient starts with the active `--color-sidebar` value and ends with `--color-sidebar-depth` (`#22213e` in light mode, `#1c1b31` in dark mode). This retains the light palette while allowing dark navigation to follow the same navy family as the dialog header. The brand border uses the decorative champagne token; the Limits warning badge keeps its own warning text/background tokens and explicit label. These mappings have bounded runtime evidence rather than a whole-application palette sign-off.

## Geometry, type and elevation

Body/form text uses the existing local system-font stack and a 16-pixel base; hierarchy uses the shared type tokens. Body explanations use sentence case. Short navigation or identity labels may use uppercase; this exception does not authorize uppercase paragraphs. The eight existing decorative SVG glyphs follow [the icon contract](icon-contract.md).

Use the existing small elevation vocabulary deliberately:

| Layer | Token | Intended use |
| --- | --- | --- |
| Ordinary surface | `--shadow-sm` | Page panels and record surfaces; use spacing and tonal differences before extra nested borders. |
| Contextual feedback | `--shadow-md` | Notices/recovery surfaces that need separation from nearby content. |
| Floating menu/action surface | `--shadow-lg` | Account/menu surfaces and existing save bars where appropriate. |
| Blocking workspace | `--shadow-xl` | Existing dialogs and contextual overlays, with preserved focus ownership. |

The current CSS still contains legacy declarations and feature-specific surfaces. This table is the intended hierarchy, not proof that every declaration has been consolidated or every popup is visually accepted.

The current guide/account/profile/More checks resolve ordinary panels to `--shadow-sm`, recovery notices to `--shadow-md`, account menus to `--shadow-lg` and blocking profiles/More sheets to `--shadow-xl`. Inset warning/selection stripes and focus rings convey state rather than another elevation level; keep them intact. These are bounded component checks, not acceptance of every legacy surface. Role descriptions and period-context kickers retain their source casing; short navigation section labels and stored codes retain their existing treatment.

Controls target at least 44 pixels where the existing design system applies; inputs must not shrink below their usable contents. Intrinsic grids, wrapping flex groups, `min-width: 0` and explicit local comparison scrolling are preferred to hiding overflow. Names, dates and warnings must remain readable. A 769-pixel header case showed why “no page overflow” alone is insufficient: controls can consume the title's entire width.

Mapped read-only profile calendar fields use `d MMM yyyy`; native date inputs and request values retain ISO dates. Calendar formatting validates the exact date and leaves malformed values unchanged rather than rolling them into another day. Approval/archive audit instants use the existing audit-time formatter with an explicit display zone; an unzoned value is labeled as such, and an invalid instant is unavailable. Numeric precision, zero/false values and unit names are retained. These rules have bounded profile/approval evidence, not certification of every date or number in the app.

## Responsive and workflow boundaries

Preserve one editor DOM and its draft while resizing. Use dynamic viewport dimensions with stable fallbacks where supported. Keep safe-area treatments scoped to navigation, dialog edges and sticky actions. When a rules save dock consumes over 40% of the available viewport, it follows the editor in document flow rather than obscuring controls; it returns to its original sticky behavior when space permits.

Existing API methods, payloads, roles, selected-month semantics, assignment calculations, import decisions, persisted fields, export contents and explicit publication boundaries remain protected by [the workflow invariant register](protected-workflow-invariants.json). Visual changes never authorize a backend or production operation.

Later changes must record the affected source snapshot, the visual/interaction reason, exact test scope and limitations in `execution-status.md` and a bounded review artifact. Source inventories, matching hashes, test totals and the number of agents are not whole-requirement acceptance. Physical-device and native assistive-technology checks remain explicitly pending until performed.
