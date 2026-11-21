"""Build plaintext site data (../_plain_data/*.json) from the reviewed CSV masters in ../universities db/.
Nothing is edited in the source files. Run via ../build.sh (then encrypt.py)."""
import csv, json, os, re, datetime, collections

csv.field_size_limit(10**9)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # Product db/
SRC = os.path.join(ROOT, "universities db")
OUT = os.path.join(ROOT, "_plain_data")
os.makedirs(OUT, exist_ok=True)


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


# ---------------- normalisation ----------------
FAMILIES = ["International recruitment leadership", "UK onshore recruitment", "Agent relations / onboarding",
            "Regional / country recruitment", "International marketing", "Admissions / compliance",
            "Progression / articulation", "Academic / partnership management"]


def families_of(text):
    t = text.lower()
    f = set()
    if "leadership" in t or re.match(r"^international recruitment\b(?!.*(manager|team))", t) and "marketing" not in t.split(";")[0]:
        f.add(0)
    if re.search(r"onshore|uk-based|uk based", t): f.add(1)
    if "agent" in t: f.add(2)
    if re.search(r"regional|country|countries", t): f.add(3)
    if "marketing" in t: f.add(4)
    if re.search(r"admission|compliance|visa|\bcas\b|sponsor", t): f.add(5)
    if re.search(r"progression|articulation|\btne\b|pathway", t): f.add(6)
    if re.search(r"partnership|academic|mobility", t): f.add(7)
    return sorted(f)


def canon_family(name):
    n = name.lower()
    for i, kw in enumerate(["leadership", "onshore", "agent", "regional", "marketing", "admissions", "progression", "academic"]):
        if kw in n:
            return i
    return -1


def cov_bucket(s):
    t = s.lower()
    if t.startswith("research pending"): return "Pending"
    if t.startswith("completed — contact route") : return "Route confirmed"
    if re.match(r"^(completed — )?no\b", t) or "no public" in t or "no named" in t or "no separate" in t or "no current public" in t: return "No public route found"
    return "Route recorded — to verify" if t.strip() else "Other"


def first_word(s, allowed, default="Review"):
    w = re.split(r"[\s—:(,;-]+", s.strip(), maxsplit=1)[0].capitalize() if s.strip() else ""
    return w if w in allowed else default


def stage(s):
    s = s.strip()
    return re.split(r"\s+[—–(-]\s*|;", s, maxsplit=1)[0].strip() or "Prospect"


def type_cat(t):
    x = t.lower()
    if not x: return "Unknown"
    if re.search(r"pathway|sixth|foundation|progression provider|international college", x): return "Pathway / sixth form"
    if re.search(r"conservatoire|music|dance|drama|theatre|art and design|art history|university of the arts|creative", x): return "Specialist / arts"
    if re.search(r"further education|college|further and higher|university centre", x) and "university" not in x.replace("university centre", ""): return "College (FE / HE)"
    if re.search(r"universit|higher education institution|higher-education institution|\buuk\b|russell|federation", x): return "University"
    return "Other provider"


NATIONS = {"England", "Scotland", "Wales", "Northern Ireland"}


def nation(n, place_country):
    n = n.replace(" (United Kingdom)", "").strip()
    if n in NATIONS: return n
    if place_country in NATIONS: return place_country
    return ""


def hav(a, b, c, d):
    import math
    x, y = math.radians(c - a), math.radians(d - b)
    h = math.sin(x / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(y / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def main():
    inst = read("institutions.csv")
    cons = read("contacts.csv")
    cov = read("role_coverage_register.csv")
    prov = read("provider_coverage_register.csv")
    gc = json.load(open(os.path.join(ROOT, "geocache_inst.json"))) if os.path.exists(os.path.join(ROOT, "geocache_inst.json")) else {"nom": {}, "place": {}}

    # contacts per institution
    per = collections.defaultdict(lambda: {"n": 0, "email": 0, "named": 0, "phone": 0, "fam": set()})
    crow = []
    ccols = ["id", "inst", "name", "title", "role", "fam", "team", "regions", "email", "phone", "route", "evidence", "source", "checked", "status", "owner", "last", "next", "notes"]
    for c in cons:
        fam = families_of(c["Role Category"] + " " + c["Job Title"] if False else c["Role Category"])
        p = per[c["Institution ID"]]
        p["n"] += 1; p["email"] += bool(c["Email"]); p["named"] += bool(c["Contact Name"]); p["phone"] += bool(c["Phone"]); p["fam"].update(fam)
        crow.append([c["Contact ID"], c["Institution ID"], c["Contact Name"], c["Job Title"], c["Role Category"], fam, c["Team / Department"],
                     c["Countries / Regions Covered"], c["Email"], c["Phone"], c["Contact Route Type"], c["Agent Onboarding Evidence"],
                     c["Source URL"], c["Source Checked Date"], c["Contact Status"], c["Partnership Owner"], c["Last Contacted"], c["Next Follow-up"], c["Notes"]])
    dump("contacts.json", {"cols": ccols, "rows": crow})

    # coverage register
    covrows = []
    covby = collections.defaultdict(lambda: [None] * len(FAMILIES))
    for r in cov:
        fi = canon_family(r["Target Role Family"])
        b = cov_bucket(r["Coverage Status"])
        covrows.append([r["Institution ID"], fi, b, r["Coverage Status"], r["Contact IDs"], r["Evidence Source URLs"], r["Last Checked Date"], r["Research Notes"]])
        if fi >= 0: covby[r["Institution ID"]][fi] = b
    dump("coverage.json", {"cols": ["inst", "fam", "bucket", "status", "contacts", "sources", "checked", "notes"], "rows": covrows, "families": FAMILIES})

    # providers
    dump("providers.json", {"cols": ["source", "sourceUrl", "checked", "candidate", "disposition", "inst", "instName", "contacts", "profile", "note"],
                            "rows": [[p["Discovery Source"], p["Discovery Source URL"], p["Source Checked Date"], p["Discovery Candidate Name"], p["Disposition"], p["Institution ID"],
                                      p["Database Institution Name"], p["Contact Count"], p["Profile Status"], p["Review Note"]] for p in prov]})

    # institutions
    icols = ["id", "name", "type", "typeCat", "nation", "city", "web", "intlUrl", "partUrl", "context", "fit", "priority", "priorityNote", "sources",
             "checked", "stage", "statusRaw", "dupKey", "complete", "completeNote", "notes", "lat", "lng", "prec", "nContacts", "nEmail", "nNamed", "nPhone", "famHave", "cov", "reconstructed"]
    irows = []; stats = collections.Counter()
    for r in inst:
        city = r["City"].strip()
        key = f"{r['Institution Name'].strip()}|{city}"
        nom = gc["nom"].get(key); pl = gc["place"].get(city) if city else None
        rev = gc.get("rev", {}).get(f"{nom[0]:.4f},{nom[1]:.4f}") if nom else None
        area = ("London" if rev and rev[1] == "London" else rev[0]) if rev else ""
        if nom and "london campus" in nom[2].lower() and "london" not in r["Institution Name"].lower() and city.lower() != "london":
            nom = None; rev = None; area = ""  # matched a satellite London campus, not the institution's base
        if nom and pl and hav(nom[0], nom[1], pl[0], pl[1]) > 30:
            nom = None; rev = None; area = ""  # campus pin is far from the recorded town: trust the town
        if nom: lat, lng, prec = nom[0], nom[1], ("campus" if city else "name")
        elif pl: lat, lng, prec = pl[0], pl[1], "town"
        else: lat = lng = None; prec = ""
        stats[prec or "none"] += 1
        p = per[r["Institution ID"]]
        pr = r["Priority"].strip()
        recon = "reconstructed" in r["Institution Status"].lower() or "reconstructed" in r["Data Completeness"].lower()
        irows.append([r["Institution ID"], r["Institution Name"], r["Institution Type"], type_cat(r["Institution Type"]), nation(r["Country / Nation"], (pl[2] if pl else "") or (rev[2] if rev else "")),
                      city or area, r["Website"], r["International Recruitment URL"], r["Partnership URL"], r["International Student / Market Context"], r["Partnership Fit"],
                      first_word(pr, {"High", "Medium", "Low"}), pr if len(pr) > 8 else "", [u.strip() for u in r["Source URLs"].split(";") if u.strip()],
                      r["Source Checked Date"], stage(r["Institution Status"]), r["Institution Status"], r["Duplicate Check ID"],
                      first_word(r["Data Completeness"], {"High", "Medium", "Low"}, "Medium"), r["Data Completeness"] if len(r["Data Completeness"]) > 8 else "", r["Notes"],
                      None if lat is None else round(lat, 5), None if lng is None else round(lng, 5), prec,
                      p["n"], p["email"], p["named"], p["phone"], sorted(p["fam"]), covby.get(r["Institution ID"], [None] * len(FAMILIES)), recon])
    dump("institutions.json", {"cols": icols, "rows": irows, "families": FAMILIES})

    # manifest
    src_files = ["institutions.csv", "contacts.csv", "role_coverage_register.csv", "provider_coverage_register.csv"]
    mt = {f: datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(SRC, f))).isoformat(timespec="minutes") for f in src_files}
    bucket = collections.Counter(r[2] for r in covrows)
    manifest = {"generated": datetime.datetime.now().isoformat(timespec="minutes"), "sourceModified": mt,
                "institutions": len(irows), "contacts": len(crow), "coverageChecks": len(covrows), "providers": len(prov),
                "withEmail": sum(1 for c in cons if c["Email"]), "named": sum(1 for c in cons if c["Contact Name"]),
                "mapped": len(irows) - stats["none"], "geo": dict(stats), "coverage": dict(bucket),
                "families": FAMILIES}
    dump("manifest.json", manifest)
    print("institutions", len(irows), "contacts", len(crow), "coverage", len(covrows), "providers", len(prov), "geo", dict(stats), "cov", dict(bucket))


if __name__ == "__main__":
    main()
