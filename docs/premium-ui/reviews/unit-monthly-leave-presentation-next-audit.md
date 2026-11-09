# Monthly unit leave counts: presentation audit

This is a read-only finding for the next frontend batch. The current app remains at 40 accepted requirements; no unit or backend code was changed by this audit.

`unit_leave_summary` counts unique assigned people with an active leave record overlapping the selected month. Active statuses include approved, requested and imported pending review. The count does not mean that all those people are absent together, absent all day, or unavailable for every operation.

The current frontend labels that aggregate ?on leave? and labels assigned minus that count ?available? or ?roughly available.? Its bar also compares that monthly aggregate with a configured minimum-free value. This can imply a daily staffing conclusion that the returned monthly data does not establish. The complete `unitAvailability` body is unchanged from the saved pre-V8 source, so this is an existing issue rather than a regression from the new import summary.

The proposed correction is presentation only: retain every returned count and the existing subtraction, describe monthly record coverage accurately, and present configured rules separately from a daily safety decision. Explain that pending requests are included and that actual availability depends on the duty date, session and returned operation-specific checks. Do not alter eligibility, assignments, validation rules or API fields.

Before integration, use faithful fixtures with approved and pending requests on different dates and sessions. Verify exact counts, names, rule values, roles and native unit/profile/modal navigation at phone, desktop, enlarged-text and short layouts across three engines. Original 147 and the broader goal remain incomplete until this and every other applicable representation have been reviewed.

The JSON companion records source hashes, line anchors, baseline evidence and the complete runtime gates.
