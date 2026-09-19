"""Entity pools for SDOC synthetic data.

Every value here is grounded in the real APRIL SDOC samples
(APRIL SDOC - Email Samples/*.msg and sdoc sample docs - SI BL Compare/*).
The goal is that a classifier/extractor trained on this data behaves the
same way it would on the real inbox.
"""

# ---------------------------------------------------------------------------
# Departments / handling desks  (subject-line prefixes seen in real data)
#   AIE   = Asia Import/Export desk
#   AFPTME= Africa/PT Middle East desk
#   AFRT  = Africa freight desk
#   AFEMY = Malaysia desk
# ---------------------------------------------------------------------------
DEPARTMENTS = ["AIE", "AFPTME", "AFRT", "AFEMY"]

# ---------------------------------------------------------------------------
# Carriers and their real BL/booking number formats.
#   Each carrier has a prefix + digit pattern lifted from the samples:
#   MSC     -> MEDUUD######   / booking MSDUL0942######
#   CMA CGM -> SIJ#######     (also MCLSIN / MCLBUA for Monter thru CMA)
#   HAPAG   -> HLCUSIN#########  / short refs like 92792353
#   OOCL    -> OOLU########## / PSGSE#######  / booking 231#######
#   EVERGREEN-> EGLV############ / 070500######
#   ONE     -> SINF######## / ONEYSINF#######
#   YANG MING-> YMJAI######### / I#########
#   PIL     -> SIN#########
# ---------------------------------------------------------------------------
CARRIERS = [
    {"code": "MSC",    "name": "MEDITERRANEAN SHIPPING COMPANY", "bl_prefix": "MEDUUD", "bl_digits": 6,  "booking_prefix": "MSDUL09425", "booking_digits": 5},
    {"code": "CMA",    "name": "CMA CGM",                        "bl_prefix": "SIJ",    "bl_digits": 7,  "booking_prefix": "SIJ",         "booking_digits": 7},
    {"code": "HAPAG",  "name": "HAPAG-LLOYD",                    "bl_prefix": "HLCUSIN","bl_digits": 9,  "booking_prefix": "",            "booking_digits": 8},
    {"code": "OOCL",   "name": "ORIENT OVERSEAS CONTAINER LINE", "bl_prefix": "OOLU",   "bl_digits": 10, "booking_prefix": "PSGSE",       "booking_digits": 7},
    {"code": "EVER",   "name": "EVERGREEN LINE",                 "bl_prefix": "EGLV",   "bl_digits": 12, "booking_prefix": "0705002",     "booking_digits": 5},
    {"code": "ONE",    "name": "OCEAN NETWORK EXPRESS",          "bl_prefix": "SINF",   "bl_digits": 8,  "booking_prefix": "ONEYSINF",    "booking_digits": 5},
    {"code": "YM",     "name": "YANG MING",                      "bl_prefix": "YMJAI",  "bl_digits": 9,  "booking_prefix": "I",           "booking_digits": 9},
    {"code": "PIL",    "name": "PACIFIC INTERNATIONAL LINES",    "bl_prefix": "SIN",    "bl_digits": 9,  "booking_prefix": "SIN",         "booking_digits": 9},
    {"code": "MONTER", "name": "MONTER GLOBAL LOGISTICS",        "bl_prefix": "MCLSIN", "bl_digits": 7,  "booking_prefix": "MCLSINJEA25", "booking_digits": 5},
]

# ---------------------------------------------------------------------------
# Ports:  (display name used on docs, country, UN/LOCODE-ish code)
# Loading ports are the real APRIL origin ports; discharge ports are the
# real destinations seen across the samples.
# ---------------------------------------------------------------------------
LOADING_PORTS = [
    ("SINGAPORE", "SINGAPORE", "SGSIN"),
    ("NANTONG", "CHINA", "CNNTG"),
    ("RUGAO/NANTONG/SHANGHAI", "CHINA", "CNSHA"),
    ("PORT KLANG (WESTPORT)", "MALAYSIA", "MYPKG"),
    ("NHAVA SHEVA", "INDIA", "INNSA"),
    ("BUATAN", "INDONESIA", "IDBUA"),
]

DISCHARGE_PORTS = [
    ("JEBEL ALI", "UAE", "AEJEA"),
    ("MOMBASA", "KENYA", "KEMBA"),
    ("TUTICORIN", "INDIA", "INTUT"),
    ("KLAIPEDA", "LITHUANIA", "LTKLJ"),
    ("HOUSTON", "US", "USHOU"),
    ("NEW YORK", "US", "USNYC"),
    ("LONG BEACH", "US", "USLGB"),
    ("SAVANNAH", "US", "USSAV"),
    ("BALTIMORE", "US", "USBAL"),
    ("HOCHIMINH CITY", "VIETNAM", "VNSGN"),
    ("PYEONGTAEK", "SOUTH KOREA", "KRPTK"),
    ("BUSAN", "SOUTH KOREA", "KRPUS"),
    ("KOPER", "SLOVENIA", "SIKOP"),
    ("GDANSK", "POLAND", "PLGDN"),
    ("MERSIN", "TURKEY", "TRMER"),
    ("ASHDOD", "ISRAEL", "ILASH"),
    ("APAPA", "NIGERIA", "NGAPP"),
    ("CONAKRY", "GUINEA", "GNCKY"),
    ("VALPARAISO", "CHILE", "CLVAP"),
    ("CALLAO", "PERU", "PECLL"),
    ("FREMANTLE", "AUSTRALIA", "AUFRE"),
    ("BRISBANE", "AUSTRALIA", "AUBNE"),
    ("YANGON", "MYANMAR", "MMRGN"),
    ("KARACHI", "PAKISTAN", "PKKHI"),
    ("AQABA", "JORDAN", "JOAQB"),
    ("CEBU", "PHILIPPINES", "PHCEB"),
]

# ---------------------------------------------------------------------------
# Customers (consignee / notify).  Real names from the samples.
# ---------------------------------------------------------------------------
CUSTOMERS = [
    {"name": "AL GURG STATIONERY LLC", "addr": ["P.O. BOX 5069", "DUBAI, UNITED ARAB EMIRATES"]},
    {"name": "VITAL SOLUTIONS PTE. LTD.", "addr": ["77 ROBINSON ROAD", "#21-01 ROBINSON 77", "SINGAPORE 068896"]},
    {"name": "SAFQA LIMITED", "addr": ["P.O. BOX 99423-80100", "TONONOKA ROAD", "MOMBASA, KENYA", "PIN NO.: P051376597X"]},
    {"name": "NAGAPPA EXPORTS", "addr": ["NEW NO : 23, L-BLOCK, 17TH STREET", "ANNA NAGAR EAST", "CHENNAI, TAMIL NADU 600102", "GST NO - 33AACFN6792L1ZU"]},
    {"name": "ROXCEL TRADING GMBH", "addr": ["OPERNRING 3-5", "1010 VIENNA, AUSTRIA"]},
    {"name": "INTERNATIONAL FOREST PRODUCTS LLC", "addr": ["6 HOLLIS STREET", "SUITE 100", "FRAMINGHAM, MA 01702, USA"]},
    {"name": "CLIFFORD PAPER INC", "addr": ["70 EAST STREET", "RIDGEFIELD, NJ 07657, USA"]},
    {"name": "KPP-ANTALIS (SINGAPORE) PTE. LTD.", "addr": ["8 TEMASEK BOULEVARD", "#42-01 SUNTEC TOWER 3", "SINGAPORE 038988"]},
    {"name": "BALL & DOGGETT AUSTRALIA PTY LTD", "addr": ["43-45 METROPOLITAN ROAD", "ENFIELD NSW 2136, AUSTRALIA"]},
    {"name": "TOAN LUC PAPER JOINT STOCK COMPANY", "addr": ["LOT B, TAN DONG HIEP B IZ", "DI AN, BINH DUONG, VIETNAM"]},
    {"name": "UAB NOVAKOPA", "addr": ["SAVANORIU PR. 187", "LT-02300 VILNIUS, LITHUANIA"]},
    {"name": "MOORIM SP CO., LTD", "addr": ["656, GANGNAM-DAERO, GANGNAM-GU", "SEOUL, SOUTH KOREA", "T. 82-2-3485-1500"]},
    {"name": "KTP CO., LTD", "addr": ["KTP BLDG., 36 SANGWON-GIL", "SEOUNGDONG-GU, SEOUL, SOUTH KOREA", "TEL:02-2285-6025"]},
    {"name": "HABRAS INTERNATIONAL LIMITED", "addr": ["OFFICE 1204, THE BURLINGTON TOWER", "BUSINESS BAY, DUBAI, UAE"]},
    {"name": "ORIENT LINKS CO (LLC)", "addr": ["P.O. BOX 61041", "JEBEL ALI, DUBAI, UAE"]},
    {"name": "PACIFIC OFFICE (M) SDN BHD", "addr": ["LOT 6, JALAN P/7", "SECTION 13, 43650 BANDAR BARU BANGI", "SELANGOR, MALAYSIA"]},
    {"name": "TOPKOPY MIDDLE EAST FZE", "addr": ["P.O. BOX 17436", "JEBEL ALI FREE ZONE, DUBAI, UAE"]},
    {"name": "EAST BRIGHT FZ-LLC", "addr": ["RAKEZ AMENITY CENTER", "AL HAMRA INDUSTRIAL ZONE, RAK, UAE"]},
    {"name": "CERIEX", "addr": ["ZONE INDUSTRIELLE", "CONAKRY, GUINEA"]},
    {"name": "3S PAPER PRODUCTS SDN BHD", "addr": ["NO 12, JALAN INDUSTRI 3/6", "RAWANG INTEGRATED INDUSTRIAL PARK", "48000 RAWANG, SELANGOR, MALAYSIA"]},
]

# ---------------------------------------------------------------------------
# Shipper entities: APRIL's trading arms (from the docs).
# ---------------------------------------------------------------------------
SHIPPERS = [
    {"name": "APRIL FINE PAPER TRADING (MIDDLE EAST) FZE", "addr": ["#813, 4 EA, DUBAI AIRPORT FREE ZONE", "P.O. BOX: 293775, DUBAI, UNITED ARAB EMIRATES"]},
    {"name": "ASIA PACIFIC PAPERBOARD TRADING PTE LTD", "addr": ["80 RAFFLES PLACE, #50-01 UOB PLAZA 1", "SINGAPORE 048624"]},
    {"name": "APRIL FINE PAPER TRADING", "addr": ["ON BEHALF OF VITAL SOLUTIONS PTE LTD", "77 ROBINSON ROAD, #21-01", "SINGAPORE 068896"]},
    {"name": "APRIL FAR EAST (M) SDN BHD", "addr": ["TOWER 2, AVENUE 5, LEVEL 6", "BANGSAR SOUTH CITY, NO. 8 JALAN KERINCHI", "59200 KUALA LUMPUR, MALAYSIA"]},
]

# ---------------------------------------------------------------------------
# Commodities (paper/paperboard products APRIL trades).
# ---------------------------------------------------------------------------
COMMODITIES = [
    {"desc": "MULTIPURPOSE PAPER - A4 - PAPERONE COPIER", "hs": "48025600"},
    {"desc": "ASIA SYMBOL FOOD SERVICE BOARD (CUPSTOCK/HI-BULK) - ALLINONE", "hs": "48109200"},
    {"desc": "PAPERBOARD", "hs": "48109200"},
    {"desc": "FUJITO PAPERONE INKJET PAPER", "hs": "48025500"},
    {"desc": "PAPERONE DIGITAL COPIER PAPER", "hs": "48025600"},
    {"desc": "UNCOATED WOODFREE PAPER IN REAMS", "hs": "48025700"},
    {"desc": "COATED IVORY BOARD", "hs": "48105900"},
]

# ---------------------------------------------------------------------------
# Shipping terms / BL types (subject-line suffixes).
# ---------------------------------------------------------------------------
TERMS = ["OA", "DP", "LC", "OA_CFR", "CFR"]
BL_TYPES = ["OBL", "SWB", "SURR BL", "TELEX", "HOUSE BL"]

# ---------------------------------------------------------------------------
# Internal APRIL staff (senders/recipients).  Real names & email patterns.
# ---------------------------------------------------------------------------
STAFF = [
    ("Teo Ei Leen", "eileen_teo@aprilasia.com"),
    ("Arlene Yamomo", "arlene_yamomo@aprilasia.com"),
    ("Syed Faraz Ali", "faraz_ali@aprilasia.com"),
    ("Najiha Nur Hanna", "hanna_azhari@aprilasia.com"),
    ("Ooi Sok Yong", "sokyong_ooi@aprilasia.com"),
    ("Elisa Tukiman", "elisa_tukiman@april.com.my"),
    ("Mitchelle Ting", "mitchelle_ting@aprilasia.com"),
    ("Hari Mardianto", "hari_mardianto@aprilasia.com"),
    ("Deswita Elvyani", "deswita_elvyani@aprilasia.com"),
    ("Willy Situmorang", "willy_ss@aprilasia.com"),
    ("Sathiyavani Munusamy", "sathiya@april.com.my"),
    ("Lee Guan Cheng", "guancheng_lee@april.com.my"),
]

# External counterparties (customers / forwarders who email in).
EXTERNAL_CONTACTS = [
    ("Nirmala Patwa", "nirmala@fujitogrp.com"),
    ("Manish Jain", "mj@fujitogrp.com"),
    ("Aziz Tejani", "aziztz@safqa.co.ke"),
    ("Chella Perumal", "chella.perumal@psabdp.com"),
    ("Sales Desk", "sales@roxcel.at"),
    ("Export Team", "exports@ifpla.com"),
    ("Logistics", "logistics@algurg.ae"),
    ("Documentation", "docs@vitalsolutions.sg"),
]

# ---------------------------------------------------------------------------
# Label synonyms  -- the core "same info looks different" challenge.
# When rendering SI vs BL we pick DIFFERENT labels for the same field so the
# extractor has to normalise them.
# ---------------------------------------------------------------------------
LABELS = {
    "shipper":         ["Shipper", "Shipper/Exporter", "Shipper (Principal or Seller)", "SHIPPER"],
    "consignee":       ["Consignee", "Consignee (Non-Negotiable)", "CONSIGNEE", "To the Order of"],
    "notify_party":    ["Notify Party", "Notify", "Notify Party/Intermediate Consignee", "NOTIFY PARTY"],
    "port_of_loading": ["Port of Loading", "Port of Loading (POL)", "Load Port", "POL", "PORT OF LOADING"],
    "port_of_discharge": ["Port of Discharge", "Port of Discharge (POD)", "Discharge Port", "POD", "PORT OF DISCHARGE"],
    "container_count": ["No. of Containers", "Total Containers", "No. of Containers or Packages", "Container Count"],
    "gross_weight_kg": ["Gross Weight (KG)", "Gross Wt (kgs)", "Gross Weight毛重(KGS)", "GROSS WEIGHT"],
    "vessel":          ["Vessel", "Ocean Vessel", "Vessel Name", "Export Carrier (vessel, voyage)"],
    "voyage":          ["Voyage No.", "Voy.", "Voy. No", "Voyage"],
    "commodity":       ["Commodity", "Description of Goods", "Description", "Kinds of Packages; Description of Goods"],
    "booking":         ["Booking Reference", "Booking No.", "Booking Ref", "BOOKING NO."],
    "bl_no":           ["B/L No.", "BL No.", "Bill of Lading No.", "B/L NUMBER"],
}

# The 7 fields the pipeline compares.
COMPARE_FIELDS = [
    "shipper", "consignee", "notify_party",
    "port_of_loading", "port_of_discharge",
    "container_count", "gross_weight_kg",
]
