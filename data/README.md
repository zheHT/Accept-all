# SDOC synthetic data (v2 — realistic)

Synthetic shipping-document inbox for the *Shipping document verification*
use case (email → classify → extract → compare → discrepancy report).

This set is **grounded in the real APRIL SDOC samples** (Outlook `.msg`
emails and the SI/BL PDF/DOCX/XLSX pairs). Compared to the original toy
`data/`, it uses real carriers, ports, customers, coded subject lines,
forwarded email threads, signatures, and multi-format attachments — so a
classifier/extractor that works here should transfer to the real inbox.

## Layout

```
data_v2/
├── inbox/                  520 × email_XXX.json  (500 main + 20 edge cases)
├── attachments/            SI + BL pairs (txt / pdf / docx / xlsx)
├── ground_truth.json       category + status + review_reason + defect_fields + has_defect
├── sample_submission.json  same shape, everything defaulted to OK / GENERAL
├── generate.py             the generator (deterministic, --seed)
├── pools.py                entity pools (carriers, ports, customers, labels…)
├── shipment.py             canonical shipment model + defect injection
├── render.py               attachment renderers (txt/pdf/docx/xlsx)
├── emails.py               subject + body generators, per category
└── edgecases.py            "wrong" attachment renderers (reliability extension)
```

## Email record schema (unchanged from the original toy data)

```json
{
  "email_id": "email_004",
  "from": "docs@vitalsolutions.sg",
  "subject": "REQUEST BL DRAFT _ PO 26067_ COATED IVORY BOARD__138MT",
  "body": "Hi Mitchelle, ...",
  "attachments": ["attachments/email_004_SI.txt", "attachments/email_004_BL.txt"]
}
```

## Ground-truth schema

```json
{
  "category": "BL_COMPARISON",
  "status": "MISMATCH",          // OK | MISMATCH | NEEDS_REVIEW
  "review_reason": null,         // null, or why it needs a human (see below)
  "defect_fields": ["consignee"],
  "has_defect": true
}
```

`status` is the headline outcome and is **orthogonal to `has_defect`**:

| status | meaning | has_defect | defect_fields | review_reason |
|---|---|---|---|---|
| `OK` | compared cleanly, everything matches | false | `[]` | null |
| `MISMATCH` | compared cleanly, ≥1 field differs | true | the fields | null |
| `NEEDS_REVIEW` | **could not** be compared confidently → escalate to a human | false | `[]` | one of the reasons below |

A blank field or an unreadable scan is **not** a mismatch — the system genuinely
cannot decide. Keeping that on a separate axis lets you measure false-alarm rate
(wrongly calling `MISMATCH`) separately from correctly escalating (`NEEDS_REVIEW`).

## Edge cases — the "wrong" attachments (20, `email_501`–`email_520`)

Appended after the main 500 so the base distribution is untouched. All classify
as `BL_COMPARISON` but should end in `NEEDS_REVIEW`. Five of each `review_reason`:

| review_reason | what's wrong | how it's built |
|---|---|---|
| `wrong_doc_type` | the "BL" is actually a Commercial Invoice / Packing List / Certificate of Origin | SI is a normal SI; second attachment is a different doc type |
| `missing_attachment` | comparison request with **0** attachments (3) or **only the SI** (2) | no BL to compare against |
| `unreadable` | image-only scanned PDF (no text layer → needs OCR), empty 0-byte file, or truncated/garbled PDF that won't open | `write_image_only_pdf` / `write_empty_file` / `write_garbled_pdf` |
| `missing_value` | SI present but required fields blank (`???`, `_______`, `TBA`) against a complete BL | a blank is uncertainty, not a discrepancy |

These implement the proposal's *"Messier inputs"* and *"Reliability and human
review"* extensions: when a document is unreadable, a value is missing, or the
result is uncertain, send the case for review with the reason instead of guessing.

## Categories & mix (main set, n = 500)

| Category | Count | Real-inbox signals used |
|---|---|---|
| `BL_COMPARISON` | 200 | `TO CONFIRM DOCS`, `REQUEST BL DRAFT`, coded `AIE - POD - CARRIER(BL#) - OC - INV - CUSTOMER - TERM`, `Draft BL … amend` |
| `SI_REQUEST` | 125 | `SI - <bl> - DIRECT(<carrier>) - <OC> - <POD> - <BLtype>`, `CUST SI`, `REQUEST SI`, `SI NEEDED` |
| `INVOICE_QUERY` | 75 | `BILLING … MISSING GR`, `CANCEL INVOICE`, `LOCAL CHARGES`, `D & D charges`, `Total Freight` |
| `GENERAL` | 60 | `UPDATE SUMMARY`, `Berthing Report`, SLA reminders, `_RPA_` bot notices, HR/holiday |
| `SPAM` | 40 | prize/parcel-fee/mailbox-full/phishing |

Proportions live in `MIX` in `generate.py`; pass `--n` to rescale.

## Attachments

- Only `BL_COMPARISON` emails carry attachments, and only ~55 % of them
  (`BL_WITH_ATTACH`) — the rest are "please send the draft BL" requests with
  no attachment yet (a realistic classify-but-can't-compare case).
- ~109 SI+BL pairs total. ~22 % use a **real binary format**; the rest are
  `.txt`:
  - `pdf + pdf`   — mirrors `5680009008` (BDP/MSC layout, container table)
  - `xlsx + docx` — mirrors `3751010806` (excel SI, bilingual word BL)
  - `xlsx + xlsx` — mirrors `3751011338`
- **Label synonymy is deliberate**: the SI and BL render the *same* field
  with *different* labels (e.g. `Port of Loading` vs `Load Port`,
  `Consignee` vs `To the Order of`, `Gross Weight (KG)` vs `Gross Wt (kgs)`).
  Normalising these is the "same information looks different" challenge from
  the proposal.

## The 7 comparison fields

`shipper, consignee, notify_party, port_of_loading, port_of_discharge,
container_count, gross_weight_kg`.

## Defects (ground truth is causally correct)

The generator builds one **canonical shipment** (the truth), renders the SI
from it, then renders the BL as either a faithful copy or a copy with 1–2
**injected** field mismatches. Because the mismatch is applied at generation
time, `ground_truth.json` cannot drift from the documents.

- ~50 % of attachment-bearing pairs have ≥1 defect (`DEFECT_RATE`).
- `defect_fields` lists exactly the mismatched fields; `has_defect` is the
  boolean; `status` is `MISMATCH` when `has_defect`, else `OK`. Emails with no
  attachments (or non-comparison categories) always have `defect_fields: []`,
  `has_defect: false`, `status: OK`. The 20 edge cases are `NEEDS_REVIEW`.

Injected values are *plausible* (a real other port, ±1 container,
±500–2000 kg) so the comparison step is genuinely tested rather than trivial.

## Regenerate

```bash
pip3 install openpyxl python-docx reportlab   # for xlsx/docx/pdf
python3 generate.py --seed 42 --n 500 --out .
```

Deterministic for a given `--seed`. Change the seed for a fresh draw.

## Notes for the pipeline

- Plain-text pairs work with the base pipeline unchanged.
- PDF/DOCX/XLSX pairs exercise the "PDF and Word attachments" and table-
  extraction extensions from the proposal (`pdftotext`, `python-docx`,
  `openpyxl` all read them back cleanly).
- Bodies contain forwarded threads, signatures, and external-sender warning
  banners — good for testing that classification keys off the right signal
  and not on boilerplate.
