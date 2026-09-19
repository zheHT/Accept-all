"""Email body + subject generators, per category.

Full realism: coded subjects, forwarded threads, staff signatures with DID
phone numbers, external-sender warning banners, and mixed formatting -- all
patterns lifted from the real APRIL SDOC .msg samples.

Categories:
  BL_COMPARISON  -- "TO CONFIRM DOCS" / "REQUEST BL DRAFT" / "Draft BL ... amend"
  SI_REQUEST     -- "REQUEST SI" / "CUST SI" / "SI NEEDED" / "LATEST SI"
  INVOICE_QUERY  -- "BILLING ... MISSING GR" / "CANCEL INVOICE" / "LOCAL CHARGES" / "D & D charges"
  GENERAL        -- "UPDATE SUMMARY" / berthing reports / SLA reminders / RPA bots / HR
  SPAM           -- marketing / phishing-style
"""
import random
import pools

WARNING_BANNER = ("WARNING: This email originated outside of our organisation. "
                  "As a security measure, please exercise caution with E-Mail "
                  "content and any links or attachments.")


def _staff(rng):
    return rng.choice(pools.STAFF)


def _external(rng):
    return rng.choice(pools.EXTERNAL_CONTACTS)


def _sig(name):
    did = f"+971 04 4938{random.randint(200,299)}"
    return (f"\n\nBest Regards,\n{name}\nShipping Documentation\n"
            f"DID : {did}\nAPRIL Fine Paper Trading (Middle East) Fze\n"
            f"#813, 4 EA, Dubai Airport Free Zone\n"
            f"P.O. Box : 293775, Dubai, United Arab Emirates\n"
            f"Website : www.aprilasia.com | www.paperone.com")


def _quoted_thread(rng, ship, depth=1):
    """Build a forwarded/quoted thread tail."""
    out = []
    for _ in range(depth):
        who, addr = _staff(rng) if rng.random() < 0.5 else _external(rng)
        day = rng.choice(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
        mon = rng.choice(["December", "January"])
        out.append(
            f"\nFrom: {who} <{addr}>\n"
            f"Sent: {day}, {mon} {rng.randint(1,28)}, 2026 {rng.randint(1,11)}:{rng.randint(10,59)} {rng.choice(['AM','PM'])}\n"
            f"Subject: RE: {ship['refs']['oc_ref']}\n\n"
            f"Please follow the previous instruction. Thank you."
        )
    return "".join(out)


# ---------------------------------------------------------------------------
# Subject builders
# ---------------------------------------------------------------------------
def subject_bl_comparison(rng, ship):
    dept = rng.choice(pools.DEPARTMENTS)
    c = ship["refs"]["carrier"]
    pod = ship["port_of_discharge"].upper().replace(", ", "_")
    style = rng.random()
    if style < 0.4:
        s = (f"TO CONFIRM DOCS _ {ship['refs']['oc_ref']} _ {pod} _ "
             f"{ship['consignee']} _ {ship['refs']['bl_no']}")
    elif style < 0.7:
        s = (f"{dept} - {pod} - {c['code']}({ship['refs']['bl_no']}) - "
             f"{ship['refs']['oc_ref']} - {ship['refs']['invoice_ref']} - "
             f"{ship['consignee']} - {rng.choice(pools.TERMS)}")
    elif style < 0.85:
        s = f"REQUEST BL DRAFT _ PO {rng.randint(25000,26999)}_ {ship['commodity'][:30]}__{ship['container_count']*rng.randint(20,25)}MT"
    else:
        s = f"Draft BL {ship['vessel']} {ship['port_of_loading'].split(',')[0]} - amend BL {rng.randint(40,60):03d}"
    return ("RE_ " + s) if rng.random() < 0.5 else s


def subject_si_request(rng, ship):
    dept = rng.choice(pools.DEPARTMENTS)
    pod = ship["port_of_discharge"].upper().replace(", ", "_")
    bl = ship["refs"]["bl_no"]
    style = rng.random()
    if style < 0.4:
        s = f"SI - {bl} - DIRECT({ship['refs']['carrier']['code']}) - {ship['refs']['oc_ref']} - {pod} - {rng.choice(pools.BL_TYPES)} - {dept} - {rng.randint(1,28)}-Jan-26"
    elif style < 0.65:
        s = f"CUST SI _ MEA _ {ship['refs']['oc_ref']} __ PO_25_{rng.randint(1000,9999)}"
    elif style < 0.85:
        s = f"REQUEST SI _ {ship['refs']['oc_ref']} _ {pod} _ {ship['consignee']} _ {bl}"
    else:
        s = f"SI NEEDED_ {ship['refs']['oc_ref']} _ {ship['consignee']} _ PO_25_{rng.randint(2000,3000)} _ {ship['port_of_discharge'].split(',')[0]}"
    return ("RE_ " + s) if rng.random() < 0.5 else s


def subject_invoice_query(rng, ship):
    style = rng.random()
    if style < 0.3:
        return f"{rng.randint(2100,2200)} RAK BILLING {rng.randint(5070146000,5070146999)} MISSING GR"
    elif style < 0.55:
        return f"REQUEST TO CANCEL INVOICE -{ship['refs']['invoice_ref']} - {ship['consignee']} - {ship['refs']['oc_ref']}"
    elif style < 0.75:
        return f"RE_ LOCAL CHARGES FOB - {rng.choice(['KARGOSMAR','ELAN LOGISTICS','JETSEA'])} - {ship['refs']['oc_ref']} - TELEX RELEASE CHARGES"
    elif style < 0.9:
        return f"Mill D & D charges - {rng.randint(6437419000,6437419999)}"
    else:
        return f"Total Freight - INDIA - {ship['refs']['oc_ref']}"


def subject_general(rng, ship):
    v = ship["vessel"]
    style = rng.random()
    if style < 0.25:
        return f"{rng.randint(1,28):02d}_01_2026 - UPDATE SUMMARY {v}"
    elif style < 0.45:
        return f"daily Berthing Report - {rng.randint(1,28):02d} JAN 2026"
    elif style < 0.6:
        return f"_Reminder_Paper - Submit SI & AED_{rng.randint(1,28):02d}-01-2026"
    elif style < 0.72:
        return f"_RPA_ India HSS SD Billing Process Completed - {v}"
    elif style < 0.82:
        return f"APRIL PAPER - List of Outstanding BL (BDP SG) as of 2026-01-{rng.randint(1,28):02d}"
    elif style < 0.92:
        return f"Pending BL Release {rng.randint(1,28):02d}_01_2026"
    else:
        return rng.choice([
            "Welcoming the New Year 2026",
            "_Approval Required_ Time Off Request",
            "Miss Connection 2 January 2026",
            "Delivery planning Jan 2026",
        ])


SPAM_SUBJECTS = [
    "Congratulations! You have WON a $1,000 Gift Card - CLAIM NOW",
    "Your parcel is on hold - confirm payment of $2.99 to release",
    "URGENT: Your email storage is full - verify account immediately",
    "Exclusive offer: 90% OFF premium logistics software this week only",
    "Re: Invoice payment - kindly confirm your bank details",
    "You have (3) undelivered messages in your mailbox",
    "Increase your shipping revenue with this ONE weird trick",
    "Dear Valued Customer, update your account to avoid suspension",
    "Hot singles in your area want to connect",
    "Bitcoin investment opportunity - guaranteed 300% returns",
]


# ---------------------------------------------------------------------------
# Body builders
# ---------------------------------------------------------------------------
def body_bl_comparison(rng, ship, has_attachments):
    to_name, _ = _staff(rng)
    if has_attachments:
        intro = rng.choice([
            f"Dear {to_name.split()[0]},\n\nPlease find attached the shipping instruction and the draft bill of lading for {ship['refs']['booking']} for your confirmation. Kindly verify the BL matches the SI before we release to the line.",
            f"Hi {to_name.split()[0]},\n\nAttached are the SI and draft BL for OC {ship['refs']['oc_ref']} ({ship['commodity'][:30]}). Please check the details and confirm.",
            f"Dear {to_name.split()[0]},\n\nPls assist to check the draft BL against the SI for PO and revert with any discrepancy asap. Draft BL No. {ship['refs']['bl_no']}.",
        ])
    else:
        intro = (f"Dear {to_name.split()[0]},\n\nPlease assist to send the draft BL for "
                 f"{ship['refs']['booking']} for checking asap.\n\nThank you.")
    body = intro + _sig(_staff(rng)[0])
    if rng.random() < 0.6:
        body += "\n\n" + "_" * 30 + _quoted_thread(rng, ship, depth=rng.randint(1, 2))
    if rng.random() < 0.3:
        body = WARNING_BANNER + "\n\n" + body
    return body


def body_si_request(rng, ship):
    name, _ = _staff(rng)
    # richly detailed SI-in-body (like the real Faraz Ali sample)
    detail = (
        f"Hi {_staff(rng)[0].split()[0]}\n\n"
        f"Please find Shipping instruction for {ship['refs']['oc_ref']}.\n\n"
        f"POL: {ship['port_of_loading']}\n"
        f"POD: {ship['port_of_discharge']}\n\n"
        f"Shipper:\n{ship['shipper']}\n" + "\n".join(ship["shipper_addr"]) + "\n\n"
        f"Consignee:\n{ship['consignee']}\n" + "\n".join(ship["consignee_addr"]) + "\n\n"
        f"Notify Party:\n{ship['notify_party']}\n" + "\n".join(ship["notify_addr"]) + "\n\n"
        f"Description of Goods:\n{ship['container_count']}X{ship['container_size']}\n"
        f"{ship['commodity']}\nH.S.CODE: {ship['hs_code']}\n"
        f"GROSS WT: {ship['gross_weight_kg']:,} KG\n\n"
        f"Shipping line: {rng.choice(pools.TERMS)} TERM\n"
        f"Documents Required:\n1) 3 Original invoice\n2) 3 Packing list\n3) 3 Original BL + 3 N/N\n"
        f"Please revert with draft BL once available."
    )
    body = detail + _sig(name)
    if rng.random() < 0.4:
        body += "\n\n" + "_" * 30 + _quoted_thread(rng, ship, depth=1)
    return body


def body_invoice_query(rng, ship):
    name, _ = _staff(rng)
    intro = rng.choice([
        f"Dear Team,\n\nWe note the GR is still missing for invoice {ship['refs']['invoice_ref']}. Kindly arrange to post the GR so we can proceed with billing.",
        f"Hi,\n\nQuery on invoice {ship['refs']['invoice_ref']}: is the THC / local charge included or billed separately? Please advise the breakdown.",
        f"Dear Team,\n\nRequesting to cancel invoice {ship['refs']['invoice_ref']} for {ship['consignee']} ({ship['refs']['oc_ref']}) and reverse the PGI. Reason: booking amended.",
        f"Dear All,\n\nPlease find the D&D / detention charges for {ship['refs']['booking']}. Kindly confirm the amount before we release payment.",
    ])
    body = intro + _sig(name)
    if rng.random() < 0.4:
        body += "\n\n" + "_" * 30 + _quoted_thread(rng, ship, depth=1)
    return body


def body_general(rng, ship):
    return rng.choice([
        f"Dear All,\n\nPlease find attached the update summary for {ship['vessel']}. Loading completed, documents to follow.\n\nRegards,\nDocumentation Team",
        f"Dear Team,\n\nKindly find the daily berthing report attached. Vessel {ship['vessel']} berthed on schedule.\n\nBest,\nOperations",
        f"Reminder: Please submit SI & AED for all pending shipments by end of day. Refer to the attached outstanding list.\n\nThank you,\nDocumentation SLA",
        f"This is an automated notification. The India HSS SD Billing Process for {ship['vessel']} has completed successfully. No action required.\n\n-- RPA Bot",
        f"Dear Colleagues,\n\nWishing everyone a happy and prosperous New Year 2026! Office resumes normal operations on 2 January.\n\nWarm regards,\nManagement",
        f"Dear Team,\n\nPlease find attached the list of outstanding BL (BDP SG). Kindly action the pending items.\n\nRegards,\nDocumentation",
    ])


def body_spam(rng):
    return rng.choice([
        "CONGRATULATIONS!!! Your email address has been selected in our monthly draw. Click here to claim your $1,000 gift card now: http://bit.ly/claim-prize-now",
        "Your package could not be delivered due to unpaid customs fee of $2.99. Confirm payment within 24 hours or your parcel will be returned: http://track-parcel.info",
        "Dear user, your mailbox has exceeded its storage limit. Verify your account within 24 hours to avoid deactivation: http://webmail-verify.co",
        "LIMITED TIME OFFER! Get 90% off the #1 logistics automation suite. Trusted by 10,000+ companies. Buy now before this deal expires!",
        "Hello Dear, I am a bank officer with an urgent business proposal involving USD 4.5 million. Please reply with your bank details to proceed.",
        "You have won a brand new iPhone! To claim, simply complete this short survey and pay $1 shipping: http://free-iphone-winner.net",
    ])
