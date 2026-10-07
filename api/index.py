"""Vercel Python entrypoint. The bundle (scripts/assemble_api_bundle.py) places mg_api/ and materialsgraph/ next to this file's parent."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from mg_api.app import create_app  # noqa: E402

app = create_app()
