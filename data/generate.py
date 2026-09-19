#!/usr/bin/env python3
"""Generate realistic SDOC synthetic data (emails + attachments + ground truth).

Usage:
    python3 generate.py [--seed 42] [--n 500] [--out .]

Produces, under --out:
    inbox/email_XXX.json         one record per email
    attachments/email_XXX_SI.*   SI attachment (txt/pdf/docx/xlsx)
    attachments/email_XXX_BL.*   draft BL attachment
    ground_truth.json            category + defect_fields + has_defect per email
    sample_submission.json       same shape, everything defaulted to GENERAL

Schema of each inbox record (matches the original toy data):
    {email_id, from, subject, body, attachments: [relative paths]}

Category mix for n=500 (realistic inbox skew):
    BL_COMPARISON 200, SI_REQUEST 125, INVOICE_QUERY 75, GENERAL 60, SPAM 40
"""
import argparse
import json
import os
import random

import pools
import shipment as sh
import render
import emails as em
import edgecases as ec

CATEGORIES = ["BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM"]

# Edge cases ("wrong" attachments) appended after the main set. Each entry is
# a review_reason; the pipeline should escalate these to NEEDS_REVIEW rather
# than confidently reporting a match/mismatch. ~5 of each = ~20 total.
EDGE_PLAN = (
    ["wrong_doc_type"] * 5
    + ["missing_attachment"] * 5
    + ["unreadable"] * 5
    + ["missing_value"] * 5
)

# Proportions used to scale to any n.
MIX = {
    "BL_COMPARISON": 0.40,
    "SI_REQUEST": 0.25,
    "INVOICE_QUERY": 0.15,
    "GENERAL": 0.12,
    "SPAM": 0.08,
}

# Of BL_COMPARISON emails, this fraction actually carry SI+BL attachments
# (the rest are "please send the draft BL" requests with no attachment yet).
BL_WITH_ATTACH = 0.55
# Of the attachment-bearing pairs, this fraction have >=1 injected defect.
DEFECT_RATE = 0.5
# Of the attachment-bearing pairs, this fraction use a real binary format
# (pdf/docx/xlsx) instead of plain .txt.
REAL_FORMAT_RATE = 0.22

FORMAT_PAIRS = [
    ("pdf", "pdf"),      # both PDF   (like 5680009008)
    ("xlsx", "docx"),    # SI excel, BL word (like 3751010806)
    ("xlsx", "xlsx"),    # both excel (like 3751011338)
]


def counts_for(n):
    c = {k: round(v * n) for k, v in MIX.items()}
    # fix rounding drift
    diff = n - sum(c.values())
    c["BL_COMPARISON"] += diff
    return c


def build_category_list(n, rng):
    c = counts_for(n)
    seq = []
    for cat, k in c.items():
        seq += [cat] * k
    rng.shuffle(seq)
    return seq


def ext_for(fmt):
    return {"txt": "txt", "pdf": "pdf", "docx": "docx", "xlsx": "xlsx"}[fmt]


def render_attachment(path_noext, doc, kind, fmt, rng):
    """Write one attachment; return the written filename (with extension)."""
    path = f"{path_noext}.{ext_for(fmt)}"
    if fmt == "txt":
        text = render.si_txt(rng, doc) if kind == "SI" else render.bl_txt(rng, doc)
        render.write_txt(path, text)
    elif fmt == "pdf":
        title = "BILL OF LADING INSTRUCTION" if kind == "SI" else "BILL OF LADING (DRAFT)"
        render.write_pdf(path, doc, title, rng)
    elif fmt == "docx":
        render.write_docx(path, doc, rng)
    elif fmt == "xlsx":
        render.write_xlsx(path, doc, kind, rng)
    return os.path.basename(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    random.seed(args.seed)  # render.py uses module-level random for container ids

    inbox_dir = os.path.join(args.out, "inbox")
    att_dir = os.path.join(args.out, "attachments")
    os.makedirs(inbox_dir, exist_ok=True)
    os.makedirs(att_dir, exist_ok=True)

    cats = build_category_list(args.n, rng)
    ground_truth = {}
    submission = {}
    fmt_tally = {}

    for i, cat in enumerate(cats, start=1):
        eid = f"email_{i:03d}"
        ship = sh.make_shipment(rng)
        attachments = []
        defect_fields = []
        has_defect = False

        if cat == "BL_COMPARISON":
            subject = em.subject_bl_comparison(rng, ship)
            has_attach = rng.random() < BL_WITH_ATTACH
            if has_attach:
                n_defects = rng.choice([1, 2]) if rng.random() < DEFECT_RATE else 0
                bl, defect_fields = sh.make_bl_version(rng, ship, n_defects)
                has_defect = bool(defect_fields)
                if rng.random() < REAL_FORMAT_RATE:
                    si_fmt, bl_fmt = rng.choice(FORMAT_PAIRS)
                else:
                    si_fmt = bl_fmt = "txt"
                fmt_tally[f"{si_fmt}+{bl_fmt}"] = fmt_tally.get(f"{si_fmt}+{bl_fmt}", 0) + 1
                si_name = render_attachment(os.path.join(att_dir, f"{eid}_SI"), ship, "SI", si_fmt, rng)
                bl_name = render_attachment(os.path.join(att_dir, f"{eid}_BL"), bl, "BL", bl_fmt, rng)
                attachments = [f"attachments/{si_name}", f"attachments/{bl_name}"]
            body = em.body_bl_comparison(rng, ship, has_attach)
            frm = rng.choice(pools.STAFF + pools.EXTERNAL_CONTACTS)[1]

        elif cat == "SI_REQUEST":
            subject = em.subject_si_request(rng, ship)
            body = em.body_si_request(rng, ship)
            frm = rng.choice(pools.STAFF)[1]

        elif cat == "INVOICE_QUERY":
            subject = em.subject_invoice_query(rng, ship)
            body = em.body_invoice_query(rng, ship)
            frm = rng.choice(pools.STAFF + pools.EXTERNAL_CONTACTS)[1]

        elif cat == "GENERAL":
            subject = em.subject_general(rng, ship)
            body = em.body_general(rng, ship)
            frm = rng.choice([
                "documentation@aprilasia.com", "operations@aprilasia.com",
                "rpa.bot@aprilasia.com", "hr@aprilasia.com", "noreply@aprilasia.com",
            ])

        else:  # SPAM
            subject = rng.choice(em.SPAM_SUBJECTS)
            body = em.body_spam(rng)
            frm = rng.choice([
                "winner@prize-claims.info", "no-reply@parcel-track.co",
                "support@webmail-verify.co", "offers@logistics-deals.biz",
                "info@crypto-invest.net", "admin@secure-mailbox.org",
            ])

        record = {
            "email_id": eid,
            "from": frm,
            "subject": subject,
            "body": body,
            "attachments": attachments,
        }
        with open(os.path.join(inbox_dir, f"{eid}.json"), "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)

        ground_truth[eid] = {
            "category": cat,
            "status": "MISMATCH" if has_defect else "OK",
            "review_reason": None,
            "defect_fields": defect_fields,
            "has_defect": has_defect,
        }
        submission[eid] = {
            "category": "GENERAL", "status": "OK", "review_reason": None,
            "defect_fields": [], "has_defect": False,
        }

    # -------------------------------------------------------------------
    # Edge cases ("wrong" attachments) -> all classify as BL_COMPARISON but
    # cannot be compared cleanly, so status = NEEDS_REVIEW.
    # -------------------------------------------------------------------
    edge_start = len(cats) + 1
    edge_tally = {}
    for j, reason in enumerate(EDGE_PLAN):
        i = edge_start + j
        eid = f"email_{i:03d}"
        ship = sh.make_shipment(rng)
        attachments = []
        edge_tally[reason] = edge_tally.get(reason, 0) + 1

        if reason == "wrong_doc_type":
            # SI is fine, but the "BL" attachment is actually another doc type
            kind, (label, builder) = None, rng.choice(list(ec.WRONG_DOC_BUILDERS.values()))
            render.write_txt(os.path.join(att_dir, f"{eid}_SI.txt"), render.si_txt(rng, ship))
            render.write_txt(os.path.join(att_dir, f"{eid}_BL.txt"), builder(rng, ship))
            attachments = [f"attachments/{eid}_SI.txt", f"attachments/{eid}_BL.txt"]
            subject = em.subject_bl_comparison(rng, ship)
            body = (f"Dear Team,\n\nPlease find attached the SI and the {label} for "
                    f"{ship['refs']['booking']}. Kindly confirm the BL is in order.\n\n"
                    f"(Note: the second attachment is a {label}, not the draft BL.)")

        elif reason == "missing_attachment":
            # comparison request that claims docs but attaches 0 or only the SI.
            # Alternate deterministically so both sub-variants are represented.
            if j % 2 == 0:
                render.write_txt(os.path.join(att_dir, f"{eid}_SI.txt"), render.si_txt(rng, ship))
                attachments = [f"attachments/{eid}_SI.txt"]
                note = "the draft BL is still missing"
            else:
                attachments = []
                note = "attachments appear to have been dropped"
            subject = em.subject_bl_comparison(rng, ship)
            body = (f"Dear Team,\n\nPlease compare the SI and draft BL for "
                    f"{ship['refs']['booking']} and confirm ({note}). Thank you.")

        elif reason == "unreadable":
            mode = rng.choice(["image_pdf", "empty", "garbled"])
            if mode == "image_pdf":
                ec.write_image_only_pdf(os.path.join(att_dir, f"{eid}_SI.pdf"), ship, "SI", rng)
                ec.write_image_only_pdf(os.path.join(att_dir, f"{eid}_BL.pdf"), ship, "BL", rng)
                attachments = [f"attachments/{eid}_SI.pdf", f"attachments/{eid}_BL.pdf"]
                note = "scanned copies (image only)"
            elif mode == "empty":
                render.write_txt(os.path.join(att_dir, f"{eid}_SI.txt"), render.si_txt(rng, ship))
                ec.write_empty_file(os.path.join(att_dir, f"{eid}_BL.pdf"))
                attachments = [f"attachments/{eid}_SI.txt", f"attachments/{eid}_BL.pdf"]
                note = "the BL file appears to be empty"
            else:  # garbled
                render.write_txt(os.path.join(att_dir, f"{eid}_SI.txt"), render.si_txt(rng, ship))
                ec.write_garbled_pdf(os.path.join(att_dir, f"{eid}_BL.pdf"), rng)
                attachments = [f"attachments/{eid}_SI.txt", f"attachments/{eid}_BL.pdf"]
                note = "the BL file will not open"
            subject = em.subject_bl_comparison(rng, ship)
            body = (f"Dear Team,\n\nAttached SI and draft BL for {ship['refs']['booking']} "
                    f"for checking ({note}). Please advise.")

        else:  # missing_value
            blank_fields = rng.sample(pools.COMPARE_FIELDS, rng.choice([1, 2]))
            render.write_txt(os.path.join(att_dir, f"{eid}_SI.txt"),
                             ec.si_missing_value_txt(rng, ship, blank_fields))
            render.write_txt(os.path.join(att_dir, f"{eid}_BL.txt"), ec.bl_plain_txt(rng, ship))
            attachments = [f"attachments/{eid}_SI.txt", f"attachments/{eid}_BL.txt"]
            subject = em.subject_bl_comparison(rng, ship)
            body = (f"Dear Team,\n\nPlease compare the SI and draft BL for "
                    f"{ship['refs']['booking']}. Some SI fields were left blank by the "
                    f"customer; kindly confirm what we have.")

        frm = rng.choice(pools.STAFF + pools.EXTERNAL_CONTACTS)[1]
        record = {"email_id": eid, "from": frm, "subject": subject,
                  "body": body, "attachments": attachments}
        with open(os.path.join(inbox_dir, f"{eid}.json"), "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        ground_truth[eid] = {
            "category": "BL_COMPARISON",
            "status": "NEEDS_REVIEW",
            "review_reason": reason,
            "defect_fields": [],
            "has_defect": False,
        }
        submission[eid] = {
            "category": "GENERAL", "status": "OK", "review_reason": None,
            "defect_fields": [], "has_defect": False,
        }

    with open(os.path.join(args.out, "ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2)
    with open(os.path.join(args.out, "sample_submission.json"), "w", encoding="utf-8") as f:
        json.dump(submission, f, indent=2)

    # summary
    from collections import Counter
    cat_counts = Counter(v["category"] for v in ground_truth.values())
    status_counts = Counter(v["status"] for v in ground_truth.values())
    defects = sum(1 for v in ground_truth.values() if v["has_defect"])
    n_att = len([f for f in os.listdir(att_dir) if os.path.isfile(os.path.join(att_dir, f))])
    print(f"Generated {len(ground_truth)} emails -> {inbox_dir}")
    print(f"Category mix: {dict(cat_counts)}")
    print(f"Status mix: {dict(status_counts)}")
    print(f"Attachment files: {n_att}")
    print(f"Pairs with >=1 defect: {defects}")
    print(f"Attachment format mix: {fmt_tally}")
    print(f"Edge cases (review_reason): {edge_tally}")


if __name__ == "__main__":
    main()
