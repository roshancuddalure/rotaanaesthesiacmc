# Leave Engine Reference Notes

Last updated: 2026-05-07

## Why CSV First

The leave engine should use CSV as the official import template and support XLSX as a convenience format.

Reasoning:

- CSV is predictable for backend validation.
- CSV has clear rows and columns.
- CSV can be exported from Excel.
- CSV avoids hidden spreadsheet formatting issues.
- CSV is easier to audit and test.
- XLSX can still be accepted and converted internally to the same normalized row model.

Reference basis:

- W3C CSV on the Web describes tabular data as rows with consistent cells and column properties.
- W3C and GOV.UK emphasize metadata/schema around CSV so machines can validate and interpret tabular data correctly.

## Healthcare Rostering Planning Principles

Useful planning lessons from e-rostering guidance:

- Leave planning should preserve safe staffing levels.
- Leave pressure should be visible month-by-month and day-by-day.
- Systems should flag too many or too few people on leave.
- Rota planning benefits from clear rules, transparent requests, and auditable decisions.
- Leave and working restrictions should feed directly into availability and rota validation.

These principles support the proposed design:

- leave calendar,
- unit-wise leave pressure,
- call-level leave pressure,
- hard block for approved leave conflicts,
- warning for pending leave conflicts,
- configurable leave thresholds.

## Sources Reviewed

- W3C, Model for Tabular Data and Metadata on the Web: https://www.w3.org/TR/tabular-data-model/
- W3C, Metadata Vocabulary for Tabular Data: https://w3c.github.io/csvw/metadata/
- GOV.UK, Using metadata to describe CSV data: https://www.gov.uk/government/publications/recommended-open-standards-for-government/using-metadata-to-describe-csv-data
- NHS England, Nursing and midwifery e-rostering good practice guide: https://www.england.nhs.uk/looking-after-our-people/the-programme-and-resources/we-work-flexibly/rostering-good-practice/
- NHS England, E-rostering the clinical workforce guidance PDF: https://www.england.nhs.uk/wp-content/uploads/2020/09/e-rostering-guidance.pdf
- NHS England, National flexible working people policy framework: https://www.england.nhs.uk/long-read/national-flexible-working-people-policy-framework/

