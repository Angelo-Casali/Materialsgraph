"""Assemble the deployable API bundle in .build/api (Vercel project root).

    python scripts/assemble_api_bundle.py && cd .build/api && npx vercel deploy --prod
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".build" / "api"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache", "data", "*.egg-info")


def main() -> Path:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "api").mkdir(parents=True)
    shutil.copy2(ROOT / "api" / "index.py", OUT / "api" / "index.py")
    shutil.copy2(ROOT / "api" / "requirements.txt", OUT / "requirements.txt")
    shutil.copy2(ROOT / "api" / "vercel.json", OUT / "vercel.json")
    shutil.copytree(ROOT / "api" / "mg_api", OUT / "mg_api", ignore=IGNORE)
    shutil.copytree(ROOT / "src" / "materialsgraph", OUT / "materialsgraph", ignore=IGNORE)
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"bundle -> {OUT} ({size / 1024:.0f} KB of source)")
    return OUT


if __name__ == "__main__":
    main()
