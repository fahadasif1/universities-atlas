# Universities Atlas (product.convosoft.uk)

Private, key-gated atlas of the UK university partnerships database (`../universities db/`): institutions, recruitment/partnership contacts, role-family coverage and a UK map. Modelled on Agents Atlas (`../../agents db/agents_site`).

## Views (hash routes, all behind the access key)
- `#/map` UK map (default): pins by campus (OpenStreetMap lookup by institution name) or town centre; list of institutions in view nearest-first from the map centre, a postcode/town search or "my location"; filters (priority, has email contact, fully profiled); copy emails / export CSV of what is in view.
- `#/institutions`, `#/i/<UNI-id>` institution grid (search, filters, column picker, export, row drawer with role-family coverage, contacts and sources).
- `#/contacts`, `#/c/<CON-id>` contact grid with the same tools.
- `#/overview` summary cards; `#/progress` research progress (role-family coverage, completeness, discovery register).
- Status, stars, owner and notes are saved in the browser only (no sync). They are included in CSV exports.

## Rebuild and publish
Source of truth: `../universities db/{institutions,contacts,role_coverage_register,provider_coverage_register}.csv` (other sessions may still be editing them: check mtimes before and after a build).
```
cd "<project>/Product db/universities_site"
./build.sh        # geocode (cached) -> build/build_data.py -> plaintext in ../_plain_data -> encrypt into data/
git add -A && git commit -m "Atlas: update data" && git push
```
`build.sh` needs python `cryptography`. The geocoder sends only public institution and town names to Nominatim (1 request/second, cached in `../geocache_inst.json`) and postcodes.io.

## Access key
Data files in `data/` are AES-256-GCM encrypted; the browser derives the key (PBKDF2-SHA256, 250k) from the passphrase typed at the lock screen. The passphrase and salt live outside the repo: `../atlas_key.txt`, `../atlas_salt.bin` (never commit). `../_plain_data/` is plaintext: never commit. Changing the key: edit `atlas_key.txt`, run `./build.sh`, push.

## Gotchas
- Browsers cache `style.css`, `app.js`, `map.js`: bump the `?v=` in `index.html` when you change them.
- Every build re-encrypts with new IVs, so all `data/*` files show as modified in git. Normal.
- Test locally: `python3 -m http.server 8791` in this folder, open http://127.0.0.1:8791 (check the page title: another site may use a port).
