"""Encrypt ../_plain_data/*.json -> universities_site/data/ (AES-256-GCM, key = PBKDF2-SHA256(passphrase, salt, 250k)).
Passphrase lives in ../atlas_key.txt (outside the repo). File format: 12-byte IV + ciphertext."""
import os, glob, shutil
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SITE = os.path.join(ROOT, "universities_site"); PLAIN = os.path.join(ROOT, "_plain_data"); OUT = os.path.join(SITE, "data")
pw = open(os.path.join(ROOT, "atlas_key.txt")).read().strip().encode()
sp = os.path.join(ROOT, "atlas_salt.bin")
if not os.path.exists(sp): open(sp, "wb").write(os.urandom(16))
salt = open(sp, "rb").read()
key = PBKDF2HMAC(hashes.SHA256(), 32, salt, 250000).derive(pw)
aes = AESGCM(key)
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
open(os.path.join(OUT, "salt.bin"), "wb").write(salt)
n = 0
for f in glob.glob(os.path.join(PLAIN, "*.json")):
    iv = os.urandom(12)
    open(os.path.join(OUT, os.path.basename(f)), "wb").write(iv + aes.encrypt(iv, open(f, "rb").read(), None)); n += 1
print("encrypted", n, "files ->", OUT)
