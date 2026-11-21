"""Geocode institutions for the UK map. Only public institution names / town names are sent to the services.
1. Nominatim (OpenStreetMap), 1 request/second as per its usage policy -> campus-level point where the name matches an education place.
2. postcodes.io places lookup by town (fallback, and used to fill England/Scotland/Wales/NI).
Cache lives outside the repo: ../geocache_inst.json"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request

csv.field_size_limit(10**9)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))        # Product db/
SRC = os.path.join(ROOT, "universities db")
CACHE = os.path.join(ROOT, "geocache_inst.json")
UA = "universities-atlas-build/1.0 (internal research tool)"
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {"nom": {}, "place": {}}
cache.setdefault("rev", {})
UK = (49.8, 60.95, -8.7, 1.9)  # lat min/max, lng min/max


def save():
    json.dump(cache, open(CACHE, "w"), ensure_ascii=False)


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:  # noqa
            time.sleep(2 + i * 2)
    return None


def in_uk(la, ln):
    return UK[0] <= la <= UK[1] and UK[2] <= ln <= UK[3]


def words(s):
    stop = {"the", "of", "and", "university", "college", "london", "uk", "for", "school", "institute", "&"}
    w = {x for x in re.findall(r"[a-z]+", s.lower()) if x not in stop and len(x) > 2}
    return w or {x for x in re.findall(r"[a-z]+", s.lower()) if x not in {"the", "of", "and", "for"} and len(x) > 1}


def clean(name):
    n = re.split(r"\s+[—–]\s+|\s*\(", name)[0].strip()
    return re.sub(r"^the\s+", "", n, flags=re.I)


def nominatim(name, city):
    key = f"{name}|{city}"
    if key in cache["nom"]:
        return cache["nom"][key]
    best = None; failed = False
    nm = clean(name)
    variants = ([f"{nm}, {city}"] if city else []) + [nm, nm + " campus", nm + " university" if "universit" not in nm.lower() and "college" not in nm.lower() else nm + " main campus"]
    for q in dict.fromkeys(variants):
        res = get("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=gb&q=" + urllib.parse.quote(q))
        time.sleep(1.1)
        if res is None:
            failed = True; continue
        for r in res or []:
            la, ln = float(r["lat"]), float(r["lon"])
            if not in_uk(la, ln):
                continue
            ok_class = (r.get("category") in ("amenity", "building", "education", "office", "landuse", "man_made") or r.get("type") in ("university", "college", "school")) and r.get("category") not in ("highway", "railway", "tourism", "leisure", "shop")
            overlap = words(nm) & words(r.get("display_name", "").split(",")[0] + " " + r.get("name", ""))
            need = max(1, min(2, len(words(nm))))
            if ok_class and len(overlap) >= need:
                best = [la, ln, r["display_name"][:120]]
                break
        if best:
            break
    if best or not failed:  # a failed request is retried next run, never cached as "no match"
        cache["nom"][key] = best
    return best


def place(city):
    if city in cache["place"]:
        return cache["place"][city]
    j = get("https://api.postcodes.io/places?limit=1&q=" + urllib.parse.quote(city))
    p = ((j or {}).get("result") or [None])[0]
    cache["place"][city] = [p["latitude"], p["longitude"], p.get("country") or ""] if p and p.get("latitude") else None
    return cache["place"][city]


def run(use_nominatim=True):
    rows = list(csv.DictReader(open(os.path.join(SRC, "institutions.csv"), encoding="utf-8-sig")))
    n = 0
    for r in rows:
        city = r["City"].strip()
        if city:
            place(city)
        if use_nominatim:
            nominatim(r["Institution Name"].strip(), city)
            n += 1
            if n % 20 == 0:
                save(); print("geocoded", n, "/", len(rows), flush=True)
    save()
    return rows


def rk(la, ln):
    return f"{la:.4f},{ln:.4f}"


def reverse():
    """Label each campus point with its local authority / nation using postcodes.io bulk reverse geocoding (coordinates only)."""
    pts = sorted({rk(v[0], v[1]) for v in cache["nom"].values() if v} - set(cache["rev"]))
    for i in range(0, len(pts), 50):
        chunk = pts[i:i + 50]
        body = {"geolocations": [{"latitude": float(p.split(",")[0]), "longitude": float(p.split(",")[1]), "limit": 1, "radius": 2000} for p in chunk]}
        try:
            req = urllib.request.Request("https://api.postcodes.io/postcodes", json.dumps(body).encode(), {"Content-Type": "application/json", "User-Agent": UA})
            res = json.load(urllib.request.urlopen(req, timeout=40))["result"]
        except Exception as e:  # noqa
            print("reverse failed", e); continue
        for p, q in zip(chunk, res):
            r = (q.get("result") or [None])[0]
            cache["rev"][p] = [r.get("admin_district") or "", r.get("region") or "", r.get("country") or ""] if r else ["", "", ""]
    save()


if __name__ == "__main__":
    run(use_nominatim="--no-nominatim" not in sys.argv)
    reverse()
    hit = sum(1 for v in cache["nom"].values() if v)
    print("nominatim hits", hit, "/", len(cache["nom"]), "| places", sum(1 for v in cache["place"].values() if v), "/", len(cache["place"]))
