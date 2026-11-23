# Home heating and cooling lab

`#/lab/home-heating` simulates an 80 m² five-room flat for a whole year, hour by hour, in any place,
and compares up to four scenarios on comfort, energy, cost and CO2. Everything runs in the visitor's
browser; nothing is stored on a server. Scenarios travel in the URL (`?s=`), validated on read.

## What it models

| Part | Model | Where |
|---|---|---|
| Rooms | EN ISO 13790 5R1C network per room (air, surfaces, mass), the "simple hourly method" carried into EN ISO 52016-1; rooms coupled implicitly through partitions and open doors | `web/src/lib/sim/engine.ts` |
| Envelope | U-values and window types by construction period from the TABULA Italian typology (Politecnico di Torino, 2011); "deep renovation" is an editorial example | `apartment.ts` |
| Weather | PVGIS 5.3 typical years for 14 cities (`scripts/build_climate_presets.py`); any other place: one real year from the Open-Meteo archive (ERA5, CC BY 4.0) | `climate.ts` |
| Sun | sun position every hour, isotropic-sky irradiance on each wall, windows with frame and shutter factors | `solar.ts` |
| Emitters | power law Q = Q_design (ΔT/ΔT_design)^n: radiators 1.3, underfloor 1.1, fan coils 1.0; heat split between air, surfaces and mass | `systems.ts` |
| Generators | heat pumps: Carnot limit × quality factor at the actual temperatures, capacity falling in the cold, defrost and cycling penalties; condensing boiler efficiency vs return temperature; hybrid picks the cheaper source every hour | `systems.ts`, `engine.ts` |
| Hot water, ventilation, PV | daily draw profile and cylinder losses; heat-recovery ventilation; PV self-consumption against a 2,700 kWh/year household profile (ARERA typical household) | `engine.ts` |
| Comfort | operative temperature; cold hours below set-point − 1.5 K; warm hours above the EN 16798-1 adaptive limit (category II) or the cooling set-point + 1.5 K; window and wall surface temperatures, condensation and mould checks | `engine.ts` |
| Money | example prices and installed costs (labelled as examples), Italian 2026 tax deductions (boilers excluded), heat-pump grants, total cost of ownership and payback | `costs.ts` |

Calibration choices that are editorial (heat pump quality factors, defrost penalty, internal gains
profile, occupant window opening, example costs) are labelled in the code and on the page.

## What it is not

Not computational fluid dynamics: air movement in the 3D view is drawn from the hourly results
(temperatures, heat delivered, losses), not solved. Not a design tool: no thermal bridges, humidity,
or detailed controls, one fixed floor plan. The method section on the page says so.

## Checks

`web/src/lib/sim/sim.test.ts`: energy balance closes within 0.5%; steady state stays just under
H·ΔT; heat demand falls with insulation and with a warmer climate; heat pumps do better with
underfloor heating than with small radiators; splits hold the cooling set-point; no room swings more
than 6 K in an hour; costs, incentives and URL round-trips. E2e tests cover the page in both themes
(axe), on a phone, scenario editing and the Open-Meteo path (mocked).

## Climate presets

```bash
python scripts/build_climate_presets.py   # needs network access to re.jrc.ec.europa.eu
```

Alpine valleys and narrow coastal strips are left out: the ~30 km ERA5 grid averages them with the
high ground nearby and the typical years came out several degrees too cold.
