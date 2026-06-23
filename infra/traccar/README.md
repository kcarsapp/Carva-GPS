# Local Traccar (Carva dev)

Self-contained Traccar **6.14.5** that runs with a bundled portable **Java 21** —
no Docker, no system Java, no admin rights. Uses Traccar's embedded **H2**
database (a file under `runtime/traccar/data/`), which is plenty for development.

The web app talks to this server via `TRACCAR_URL=http://localhost:8082`.

## First-time setup

```powershell
cd infra/traccar
./setup.ps1     # downloads Java 21 + Traccar into runtime/ (~200 MB, gitignored)
./start.ps1     # starts Traccar on http://localhost:8082 (leave running)
```

Then create the **super-admin** account (the *first* user Traccar sees is made
an administrator automatically):

```bash
curl -X POST http://localhost:8082/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Carva Super Admin","email":"admin@carva.local","password":"CarvaAdmin2026!"}'
```

## Day-to-day

```powershell
cd infra/traccar; ./start.ps1
```

Stop it with `Ctrl+C` in that window.

## What's gitignored

`runtime/` holds the downloaded Java + Traccar binaries and the live H2 database.
None of it is committed — `setup.ps1` recreates the binaries, and the database is
local dev state. The committed files are just `setup.ps1`, `start.ps1`, and this
README.

## Notes

- Default device-data ports (e.g. OsmAnd on 5055, GT06 on 5023, …) are all open
  on this server, so real trackers / the simulator can report to `localhost`.
- Admin/company management, device assignment, and the killswitch all require this
  server (we're the administrator here); the public demo account can't do them.
