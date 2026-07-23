# Deploying Carva GPS to a VPS (with a real TK905B-4G tracker)

This is the production path: a cloud server with a permanent public IP that your
GPS tracker can reach over its SIM's mobile data. It runs **Traccar** (ingestion)
+ **Postgres** (storage) + the **Carva** web app.

> The local `infra/traccar/` setup is **dev-only** (Windows, embedded H2 DB). Do
> not use it in production.

---

## 0. What you need first
- A **SIM with an active data plan**, inserted in the tracker. Note the carrier's
  **APN** (search "<carrier> APN" — e.g. many are `internet`).
- The tracker's **IMEI** (printed on the device / box). Keep leading zeros.
- A credit card for the VPS (~$5/month).

---

## 1. Create the VPS
Any provider works. Recommended: **Hetzner CX22** (2 vCPU / 4 GB, ~€4.5/mo) or a
DigitalOcean / Vultr $6 droplet. Choose:
- **OS:** Ubuntu 24.04 LTS
- **Add your SSH key** during creation.

Write down the server's **public IP** (call it `SERVER_IP`). Then SSH in:
```bash
ssh root@SERVER_IP
```

---

## 2. Install Traccar + PostgreSQL
```bash
apt update && apt -y upgrade
apt -y install postgresql unzip openjdk-17-jre-headless

# --- Postgres database for Traccar ---
sudo -u postgres psql -c "CREATE DATABASE traccar;"
sudo -u postgres psql -c "CREATE USER traccar WITH PASSWORD 'CHANGE_ME_DB_PASS';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE traccar TO traccar;"

# --- Traccar (check traccar.org for the latest version number) ---
cd /tmp
wget https://github.com/traccar/traccar/releases/download/v6.6/traccar-linux-64-6.6.zip
unzip traccar-linux-64-6.6.zip
./traccar.run
```

Point Traccar at Postgres — edit `/opt/traccar/conf/traccar.xml`, replace the
default H2 `database`/`user`/`password` entries with:
```xml
<entry key='database.driver'>org.postgresql.Driver</entry>
<entry key='database.url'>jdbc:postgresql://localhost:5432/traccar</entry>
<entry key='database.user'>traccar</entry>
<entry key='database.password'>CHANGE_ME_DB_PASS</entry>
```
Start it:
```bash
systemctl restart traccar
systemctl enable traccar
journalctl -u traccar -f      # live logs — leave open in one terminal
```
Traccar is now on `http://SERVER_IP:8082`.

---

## 3. Open the firewall
Open the web port and **the TK905B-4G protocol port 5015 (Huabao/JT808)**. (Open
5093 too in case your unit uses the Watch protocol.)
```bash
ufw allow OpenSSH
ufw allow 8082/tcp     # Traccar/Carva web
ufw allow 5015/tcp     # TK905B-4G (Huabao)
ufw allow 5093/tcp     # fallback (Watch protocol)
ufw allow 80,443/tcp   # if you add a domain + HTTPS
ufw --force enable
```

---

## 4. Create the super-admin
The **first** user Traccar sees becomes an administrator automatically:
```bash
curl -X POST http://SERVER_IP:8082/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Carva Super Admin","email":"admin@carva.local","password":"CHANGE_ME_ADMIN_PASS"}'
```

---

## 5. Deploy the Carva web app
On the VPS:
```bash
apt -y install nodejs npm git
# (or install Node 20+ via nodesource for a newer version)
git clone <your-carva-repo-url> /opt/carva
cd /opt/carva
npm install
npm run build:shared
printf 'TRACCAR_URL=http://localhost:8082\n' > apps/web/.env.local
npm run build --workspace @carva/web

# run it persistently
npm i -g pm2
pm2 start "npm run start --workspace @carva/web" --name carva-web
pm2 save && pm2 startup
```
Carva is now on `http://SERVER_IP:3000`. (Optional: put Nginx + a domain +
Let's Encrypt HTTPS in front of it later.)

> Alternative: host the web app on **Vercel** instead, and set
> `TRACCAR_URL=http://SERVER_IP:8082` there. Simpler, but then the browser→Traccar
> calls aren't same-origin; the VPS route above keeps everything on one box.

---

## 6. Point the tracker at your server (SMS)
Send these as SMS to the tracker's SIM number (default password `123456`).
Exact wording varies by firmware — check your manual; common TKSTAR commands:
```
apn123456 <your-apn>                 # e.g. apn123456 internet
adminip123456 SERVER_IP 5015         # send Huabao data to your VPS
```
The device should SMS back a confirmation. Reboot it (or `reset123456`).

⚠️ **If nothing ever connects (step 7), your unit may be firmware-locked to the
vendor server** and cannot be redirected — a known limitation of some TK905B-4G
units, not a config error.

---

## 7. Verify the connection
Watch the Traccar log you left open in step 2:
```
journalctl -u traccar -f
```
When the tracker connects you'll see its protocol session and — at first — an
**"Unknown device"** warning with an id. That id is your IMEI.

---

## 8. Register the device in Carva
1. Open `http://SERVER_IP:3000`, log in as the super-admin.
2. Go to **Admin** (`/app/admin`) → add the device using its **IMEI as the unique
   id**, **including leading zeros** (e.g. `009590038494`).
3. Within a minute it should appear live on the map. 🎉

---

## Quick reference
| Item | Value |
|---|---|
| Traccar web / API | `http://SERVER_IP:8082` |
| Carva web app | `http://SERVER_IP:3000` |
| TK905B-4G port | **5015** (Huabao/JT808); fallback 5093 (Watch) |
| Device id | tracker **IMEI, with leading zeros** |
| Web app env | `TRACCAR_URL=http://localhost:8082` |
