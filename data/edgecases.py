"""Edge-case ("wrong") attachment renderers for the reliability extension.

These exercise the paths where the pipeline should NOT confidently report a
match/mismatch, but instead escalate: status=NEEDS_REVIEW with a review_reason.

Four flavours (proposal's "Messier inputs" / "Reliability and human review"):
  wrong_doc_type     -- an invoice / packing list / COO where an SI or BL was expected
  missing_attachment -- comparison request with 0 or only 1 doc attached
  unreadable         -- image-only scanned PDF, empty file, or truncated/garbled bytes
  missing_value      -- SI/BL present but a required field is blank ('???', '____')
"""
import random
import pools


# ---------------------------------------------------------------------------
# wrong_doc_type : documents that are NOT an SI/BL comparison pair
# ---------------------------------------------------------------------------
def commercial_invoice_txt(rng, ship):
    r = ship["refs"]
    return "\n".join([
        "COMMERCIAL INVOICE",
        "=" * 40,
        "",
        f"Invoice No.: {r['invoice_ref']}",
        f"Invoice Date: {rng.randint(1,28):02d}-JAN-2026",
        f"Seller: {ship['shipper']}",
        f"Buyer: {ship['consignee']}",
        f"Booking Ref: {r['booking']}",
        "",
        "Description                         Qty        Unit Price       Amount (USD)",
        f"{ship['commodity'][:28]:<28}    {ship['container_count']*100:>6}     45.00       {ship['container_count']*4500:>10,}",
        "",
        f"Total Amount: USD {ship['container_count']*4500:,}.00",
        "Payment Terms: 30 days from B/L date",
        "Incoterms: CFR",
        "",
        "*** THIS IS A COMMERCIAL INVOICE - NOT A SHIPPING INSTRUCTION ***",
    ]) + "\n"


def packing_list_txt(rng, ship):
    r = ship["refs"]
    lines = [
        "PACKING LIST",
        "=" * 40,
        "",
        f"Shipper: {ship['shipper']}",
        f"Consignee: {ship['consignee']}",
        f"Booking Ref: {r['booking']}",
        f"Commodity: {ship['commodity']}",
        "",
        "Carton No.      Net Wt (kg)     Gross Wt (kg)     Dimensions",
    ]
    for i in range(1, min(ship["container_count"], 4) + 1):
        lines.append(f"CTN-{i:03d}          {rng.randint(400,600)}             {rng.randint(450,650)}             120x100x110")
    lines += ["", "*** PACKING LIST ONLY - NO PORT OR VESSEL DETAILS ***"]
    return "\n".join(lines) + "\n"


def coo_txt(rng, ship):
    return "\n".join([
        "CERTIFICATE OF ORIGIN",
        "=" * 40,
        "",
        f"Exporter: {ship['shipper']}",
        f"Consignee: {ship['consignee']}",
        "Country of Origin: MALAYSIA / INDONESIA / CHINA",
        f"HS Code: {ship['hs_code']}",
        f"Description: {ship['commodity']}",
        f"Certificate No.: COO-{rng.randint(10000,99999)}",
        "Issuing Authority: MINISTRY OF INTERNATIONAL TRADE",
        "",
        "*** CERTIFICATE OF ORIGIN - NOT AN SI OR BL ***",
    ]) + "\n"


WRONG_DOC_BUILDERS = {
    "invoice": ("Commercial Invoice", commercial_invoice_txt),
    "packing_list": ("Packing List", packing_list_txt),
    "coo": ("Certificate of Origin", coo_txt),
}


# ---------------------------------------------------------------------------
# missing_value : SI/BL with blank required fields
# ---------------------------------------------------------------------------
def _lbl(rng, field):
    return rng.choice(pools.LABELS[field])


BLANK_TOKENS = ["???", "_______", "TBA", "TBC", "", "N/A", "____MT"]


def si_missing_value_txt(rng, ship, blank_fields):
    """Render an SI where `blank_fields` are left blank (unreadable/omitted)."""
    def v(field, real):
        return rng.choice(BLANK_TOKENS) if field in blank_fields else real
    r = ship["refs"]
    ctr = f"{ship['container_count']} x {ship['container_size']}"
    gw = f"{ship['gross_weight_kg']:,} KG"
    lines = [
        "SHIPPING INSTRUCTION",
        "=" * 40,
        "",
        f"{_lbl(rng,'shipper')}: {v('shipper', ship['shipper'])}",
        f"{_lbl(rng,'consignee')}: {v('consignee', ship['consignee'])}",
        f"{_lbl(rng,'notify_party')}: {v('notify_party', ship['notify_party'])}",
        f"{_lbl(rng,'port_of_loading')}: {v('port_of_loading', ship['port_of_loading'])}",
        f"{_lbl(rng,'port_of_discharge')}: {v('port_of_discharge', ship['port_of_discharge'])}",
        f"{_lbl(rng,'container_count')}: {v('container_count', ctr)}",
        f"{_lbl(rng,'gross_weight_kg')}: {v('gross_weight_kg', gw)}",
        f"{_lbl(rng,'commodity')}: {ship['commodity']}",
        f"NET WEIGHT: {rng.choice(['???','_______'])} MTS",
        f"{_lbl(rng,'booking')}: {r['booking']}",
        f"OC No.: {r['oc_ref']}",
        "Freight: PREPAID",
    ]
    return "\n".join(lines) + "\n"


def bl_plain_txt(rng, ship):
    """A faithful BL to pair against a blank-field SI (so the blank is the
    only reason a compare can't be completed, not an actual mismatch)."""
    import render
    return render.bl_txt(rng, ship)


# ---------------------------------------------------------------------------
# unreadable : image-only PDF, empty file, garbled bytes
# ---------------------------------------------------------------------------
def write_image_only_pdf(path, ship, kind, rng):
    """Rasterise the doc text into an image and embed it in a PDF, so the PDF
    has NO extractable text layer -- forcing OCR or a 'cannot read' outcome."""
    from PIL import Image, ImageDraw
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    W, H = 1240, 1754  # ~A4 at 150 dpi
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    title = "BILL OF LADING (DRAFT)" if kind == "BL" else "SHIPPING INSTRUCTION"
    rows = [
        title, "",
        f"Shipper: {ship['shipper']}",
        f"Consignee: {ship['consignee']}",
        f"Notify: {ship['notify_party']}",
        f"Port of Loading: {ship['port_of_loading']}",
        f"Port of Discharge: {ship['port_of_discharge']}",
        f"Containers: {ship['container_count']} x {ship['container_size']}",
        f"Gross Weight: {ship['gross_weight_kg']:,} KG",
        f"Vessel: {ship['vessel']}",
        f"Booking: {ship['refs']['booking']}",
    ]
    y = 80
    for line in rows:
        # slight jitter to look like a scan
        d.text((90 + rng.randint(-2, 2), y), line, fill=(20, 20, 20))
        y += 55
    # a faint diagonal "SCANNED COPY" watermark
    d.text((300, H // 2), "SCANNED COPY - NO OCR TEXT LAYER", fill=(200, 200, 200))
    img_rot = img.rotate(rng.uniform(-1.2, 1.2), fillcolor="white")

    c = canvas.Canvas(path, pagesize=A4)
    aw, ah = A4
    c.drawImage(ImageReader(img_rot), 0, 0, width=aw, height=ah)
    c.showPage()
    c.save()


def write_empty_file(path):
    open(path, "wb").close()


def write_garbled_pdf(path, rng):
    """A truncated / corrupt PDF: valid header, then random bytes, no EOF."""
    with open(path, "wb") as f:
        f.write(b"%PDF-1.5\n")
        f.write(bytes(rng.randint(0, 255) for _ in range(rng.randint(400, 900))))
        # deliberately no %%EOF / xref -> unreadable
