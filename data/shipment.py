"""Shipment model + defect injection.

We model a single canonical shipment (the TRUTH), derive the SI from it,
then derive the draft BL as either a faithful copy or a copy with 1-2
injected field defects. Because defects are applied at generation time,
ground_truth.json is causally correct rather than annotated after the fact.
"""
import random
import pools


def _digits(n):
    return "".join(random.choice("0123456789") for _ in range(n))


def make_refs(rng):
    """Generate the family of cross-referenced numbers a real shipment carries."""
    carrier = rng.choice(pools.CARRIERS)
    bl_no = f"{carrier['bl_prefix']}{_digits(carrier['bl_digits'])}"
    booking = f"{carrier['booking_prefix']}{_digits(carrier['booking_digits'])}"
    # OC reference like 5RAE-00543 : {digit}{R/S/A}{country2}-{5digits}
    region = rng.choice(["RAE", "RSG", "RMY", "RVN", "RUS", "SUS", "AAT", "ALT", "RFR", "RCY", "AKR", "APH"])
    oc_ref = f"5{region}-{_digits(5)[:5]}"
    # invoice / delivery-note style refs
    invoice_ref = f"525007{_digits(4)}"
    so_number = f"3{_digits(9)}"
    return {
        "carrier": carrier,
        "bl_no": bl_no,
        "booking": booking,
        "oc_ref": oc_ref,
        "invoice_ref": invoice_ref,
        "so_number": so_number,
    }


def make_shipment(rng):
    """Build one canonical shipment dict (the ground-truth values)."""
    refs = make_refs(rng)
    shipper = rng.choice(pools.SHIPPERS)
    customer = rng.choice(pools.CUSTOMERS)
    # notify is usually the same as consignee, sometimes a separate party
    if rng.random() < 0.7:
        notify = customer
    else:
        notify = rng.choice(pools.CUSTOMERS)
    pol = rng.choice(pools.LOADING_PORTS)
    pod = rng.choice(pools.DISCHARGE_PORTS)
    commodity = rng.choice(pools.COMMODITIES)
    n_containers = rng.choice([1, 1, 2, 3, 3, 4, 5, 6, 10, 12, 15])
    # gross weight roughly 20-24 MT per container
    per_ctr = rng.randint(20000, 24000)
    gross = n_containers * per_ctr
    ctr_size = rng.choice(["20'FCL", "40'HC", "40'HC", "20'GP"])
    vessel = rng.choice([
        "MARCOPOLO 810 V.BS005", "LE HAVRE V.QI540A", "INDO SUKSES 65 V.51NW1",
        "NAP 914 V.BS007", "MMSS 2507 V.257087E", "SOLID 16 V.044NW2",
        "PACIFIC SUN 1 V.251073E", "VISION 202 V.002",
    ])
    voyage = rng.choice(["11S", "2545E", "BS291", "QI540A", "051NW1", "BS012"])

    return {
        "refs": refs,
        "shipper": shipper["name"],
        "shipper_addr": shipper["addr"],
        "consignee": customer["name"],
        "consignee_addr": customer["addr"],
        "notify_party": notify["name"],
        "notify_addr": notify["addr"],
        "port_of_loading": f"{pol[0]}, {pol[1]}" if pol[1] not in pol[0] else pol[0],
        "pol_code": pol[2],
        "port_of_discharge": f"{pod[0]}, {pod[1]}",
        "pod_code": pod[2],
        "container_count": n_containers,
        "container_size": ctr_size,
        "gross_weight_kg": gross,
        "commodity": commodity["desc"],
        "hs_code": commodity["hs"],
        "vessel": vessel,
        "voyage": voyage,
    }


# Plausible "wrong" values used when injecting a defect, per field.
def _mutate(rng, field, ship):
    if field == "shipper":
        alt = rng.choice([s["name"] for s in pools.SHIPPERS if s["name"] != ship["shipper"]])
        return alt
    if field == "consignee":
        alt = rng.choice([c["name"] for c in pools.CUSTOMERS if c["name"] != ship["consignee"]])
        return alt
    if field == "notify_party":
        alt = rng.choice([c["name"] for c in pools.CUSTOMERS if c["name"] != ship["notify_party"]])
        return alt
    if field == "port_of_loading":
        alt = rng.choice([p for p in pools.LOADING_PORTS if p[0] not in ship["port_of_loading"]])
        return f"{alt[0]}, {alt[1]}"
    if field == "port_of_discharge":
        alt = rng.choice([p for p in pools.DISCHARGE_PORTS if p[0] not in ship["port_of_discharge"]])
        return f"{alt[0]}, {alt[1]}"
    if field == "container_count":
        # guarantee a real change: never clamp back to the original value
        old = ship["container_count"]
        if old <= 1:
            return old + rng.choice([1, 2])
        return max(1, old + rng.choice([-1, 1, 1, 2]))
    if field == "gross_weight_kg":
        # off by a transposition / rounding-style error
        return ship["gross_weight_kg"] + rng.choice([-1000, -500, 500, 1000, 2000])
    return None


def make_bl_version(rng, ship, n_defects):
    """Return (bl_dict, defect_fields). bl_dict has the SAME keys as ship
    for the 7 comparison fields; non-defective fields are copied verbatim."""
    bl = dict(ship)  # start faithful
    defect_fields = []
    if n_defects > 0:
        fields = rng.sample(pools.COMPARE_FIELDS, n_defects)
        for f in fields:
            new_val = _mutate(rng, f, ship)
            if f == "port_of_loading":
                bl["port_of_loading"] = new_val
            elif f == "port_of_discharge":
                bl["port_of_discharge"] = new_val
            else:
                bl[f] = new_val
            defect_fields.append(f)
    return bl, sorted(defect_fields)
