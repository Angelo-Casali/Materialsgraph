"""Build the climate presets used by the home heating simulator (web/public/data/climate/).

Each preset is a typical meteorological year (TMY) from PVGIS 5.3 (European Commission, Joint
Research Centre): 8760 hourly values of air temperature, relative humidity, global / direct-normal /
diffuse irradiance and wind speed, built from ERA5 and PVGIS-SARAH3 over 2005-2023.
Places squeezed between mountains and sea or in Alpine valleys are left out on purpose: the ~30 km
ERA5 grid averages them with the high ground nearby, and TMYs for Aosta, Bolzano, Genova and Trieste
came out 3-8 degrees too cold.
PVGIS data may be reused with acknowledgement of the source (Commission Decision 2011/833/EU).

The site never calls PVGIS from the browser (the service does not allow cross-origin requests);
visitors who pick another place get a real year from Open-Meteo instead (see web/src/lib/sim/climate.ts).

Usage: python scripts/build_climate_presets.py   (needs network access to re.jrc.ec.europa.eu)
"""

from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "climate"
API = "https://re.jrc.ec.europa.eu/api/v5_3/tmy?lat={lat}&lon={lon}&outputformat=json"

# id, name, country, lat, lon, UTC offset of local standard time (hours), Italian climate zone (DPR 412/93)
PLACES = [
    ("palermo", "Palermo", "IT", 38.116, 13.361, 1, "B"),
    ("cagliari", "Cagliari", "IT", 39.224, 9.122, 1, "C"),
    ("napoli", "Napoli", "IT", 40.852, 14.268, 1, "C"),
    ("bari", "Bari", "IT", 41.117, 16.872, 1, "C"),
    ("roma", "Roma", "IT", 41.893, 12.483, 1, "D"),
    ("firenze", "Firenze", "IT", 43.770, 11.256, 1, "D"),
    ("bologna", "Bologna", "IT", 44.494, 11.343, 1, "E"),
    ("milano", "Milano", "IT", 45.464, 9.190, 1, "E"),
    ("torino", "Torino", "IT", 45.070, 7.687, 1, "E"),
    ("venezia", "Venezia Mestre", "IT", 45.490, 12.242, 1, "E"),
    ("madrid", "Madrid", "ES", 40.417, -3.704, 1, None),
    ("paris", "Paris", "FR", 48.857, 2.352, 1, None),
    ("berlin", "Berlin", "DE", 52.520, 13.405, 1, None),
    ("stockholm", "Stockholm", "SE", 59.329, 18.069, 1, None),
]


def fetch(lat: float, lon: float) -> dict:
    url = API.format(lat=lat, lon=lon)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001 - network retry
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("unreachable")


def compact(raw: dict) -> dict:
    hours = raw["outputs"]["tmy_hourly"]
    if len(hours) != 8760:
        raise ValueError(f"expected 8760 hours, got {len(hours)}")
    loc = raw["inputs"]["location"]
    return {
        "elevation": loc["elevation"],
        "years": [raw["inputs"]["meteo_data"]["year_min"], raw["inputs"]["meteo_data"]["year_max"]],
        # integers keep the files small: tenths of a degree / of m/s, whole W/m2 and %
        "t": [round(h["T2m"] * 10) for h in hours],
        "rh": [round(h["RH"]) for h in hours],
        "ghi": [round(h["G(h)"]) for h in hours],
        "dni": [round(h["Gb(n)"]) for h in hours],
        "dhi": [round(h["Gd(h)"]) for h in hours],
        "ws": [round(h["WS10m"] * 10) for h in hours],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for pid, name, country, lat, lon, tz, zone in PLACES:
        data = compact(fetch(lat, lon))
        payload = {
            "id": pid,
            "name": name,
            "country": country,
            "lat": lat,
            "lon": lon,
            "tz": tz,
            "kind": "tmy",
            "source": "pvgis-tmy",
            **data,
        }
        (OUT / f"{pid}.json").write_text(json.dumps(payload, separators=(",", ":")))
        t = data["t"]
        index.append(
            {
                "id": pid,
                "name": name,
                "country": country,
                "lat": lat,
                "lon": lon,
                "zone": zone,
                "meanC": round(sum(t) / len(t) / 10, 1),
                "minC": min(t) / 10,
                "maxC": max(t) / 10,
            }
        )
        print(f"{pid:10s} mean {index[-1]['meanC']:5.1f} C  min {index[-1]['minC']:5.1f}  max {index[-1]['maxC']:5.1f}")
        time.sleep(1)
    (OUT / "index.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    main()
