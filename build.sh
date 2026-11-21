#!/bin/sh
# Rebuild plaintext data from ../universities db/*.csv, then encrypt it into data/ with the key in ../atlas_key.txt
cd "$(dirname "$0")" && python3 build/geocode.py && python3 -I build/build_data.py && python3 build/encrypt.py
