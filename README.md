# University Residence Portal

A self-hosted community web portal for student residences: a verified alumni/resident directory, a shared yearbook and a set of community tools (study rooms, time capsules, book marketplace, language tandems and more). Access is invitation-based: new members must be vouched for by existing residents and approved by an administrator.

> **Status:** personal project, shared as-is. Not audited by a third party. Review the security configuration before exposing it to the internet.

## Features

- **Peer-endorsed registration**: email OTP verification, peer identity confirmation, admin approval.
- **Resident directory and profiles** with per-field privacy controls and residence history.
- **Yearbook** and **map view** of where residents come from (local country/state/city dataset, no external geo API needed).
- **Community modules**: study rooms, academic exchanges, time capsules, recipes, music jukebox (Spotify links), match finder, city guide, language tandems, passion clubs, book marketplace, free-items box, startups board.
- **Admin tools**: roles (`student`, `admin`, `superadmin`), notifications, announcements, audit log, content reports.
- **Content moderation**: deterministic profanity filter plus a local multilingual toxicity classifier (ONNX) and image checks.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (Create React App), Tailwind CSS, lucide-react |
| Backend | Node.js 20, Express 4, Zod validation |
| Database | PostgreSQL 16 |
| Cache / rate limiting | Redis 7 |
| Auth and security | JWT in HttpOnly cookies, CSRF protection, Argon2id with server-side pepper, Helmet, Cloudflare Turnstile |
| Email | Nodemailer (SMTP) |
| Deployment | Docker Compose, Cloudflare Tunnel |

## Quick start (Docker)

Node.js is **not** required on the host.

```bash
# 1. Configure the environment
cp .env.example .env
#    Edit .env: set strong secrets, SMTP credentials, FRONTEND_URL, FOUNDER_EMAIL, ...

# 2. Build and start
docker compose build
docker compose up -d
```

The client build downloads the country/state/city dataset and the moderation model automatically. See [DOCKER_SETUP.md](DOCKER_SETUP.md) for details on refreshing the dataset.

By default the `app` container does not publish any port: traffic is expected to arrive through the `cloudflared` service. For local development, create a `docker-compose.override.yml` that binds the port to loopback only:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:5000:5000"
```

The compose file starts a Cloudflare *quick tunnel* (a temporary public URL). For a stable domain, switch to a named tunnel and set `CLOUDFLARE_TUNNEL_TOKEN`.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example) for the full list). The most important ones:

| Variable | Purpose |
|---|---|
| `POSTGRES_*`, `DATABASE_URL` | Database credentials |
| `REDIS_PASSWORD`, `REDIS_URL` | Redis credentials |
| `JWT_SECRET` | At least 64 characters. Generate with `openssl rand -base64 64` |
| `PASSWORD_PEPPER` | At least 32 characters, never change it after users exist |
| `OTP_HMAC_SECRET` | At least 32 characters |
| `FRONTEND_URL`, `FRONTEND_DOMAIN` | Exact public origin, used for CORS and email links |
| `FOUNDER_EMAIL` | This account is auto-promoted to superadmin on startup |
| `SMTP_*` | Outgoing mail (OTP codes, notifications) |
| `TURNSTILE_*` | Cloudflare Turnstile keys. The defaults are Cloudflare's public **test** keys: replace them in production and set `TURNSTILE_TEST_MODE=false` |

Frontend variables live in `client/.env` (see [`client/.env.example`](client/.env.example)). They are embedded in the browser bundle, so never put secrets there. `REACT_APP_CITY_NAME` (optional) is appended to addresses in map lookups, e.g. `Paris, France`.

**Never commit `.env` files.** They are already excluded by `.gitignore`.

## Customising the residence list

Residence/section names are placeholders (`Residence_name_1`, `Residence_name_2`, `Residence_name_3`). Replace them consistently in:

- `src/utils/validation.js` (`ALLOWED_SECTIONS`)
- `src/routes/community.js` (`TIME_CAPSULE_SECTIONS`)
- `client/src/components/ResidenceHistoryEditor.jsx`
- `client/src/components/AdministrativeModals.jsx`

The welcome message and the introductory letter are stored in the `system_settings` table and can be edited by administrators.

## Local development without Docker

Requirements: Node.js >= 20, PostgreSQL 16, Redis 7.

```bash
# Backend
npm install
npm run setup:moderation     # downloads the ONNX moderation model
npm run init-db              # applies schema.sql
npm start                    # http://localhost:5000

# Frontend (separate terminal)
cd client
npm install
npm start                    # http://localhost:3000
```

## Project structure

```
.
├── client/                 React frontend
│   ├── public/             static assets (geo-data is downloaded at build time)
│   └── src/components/     UI views and modals
├── src/
│   ├── server.js           Express app, auth, registration
│   ├── routes/             users, comms, community modules
│   ├── middleware/         auth, CSRF/CORS/Helmet, rate limiting, uploads, moderation
│   ├── utils/              crypto, sanitisation, validation, audit
│   └── config/             env validation, database
├── scripts/                moderation model downloader
├── schema.sql              database schema and default settings
├── Dockerfile
└── docker-compose.yml
```

## Security notes

- Report vulnerabilities privately (for example through GitHub's private vulnerability reporting) rather than opening a public issue.
- Uploaded images are served only to authenticated, verified sessions, except explicitly public profile content.
- Rate limiting requires Redis. Do not run without it in production.
- Change every secret and the Turnstile test keys before going live.

## Third-party data and models

- Country/state/city data: [react-country-state-city](https://github.com/venkatmcajj/react-country-state-city), downloaded at build time. Check its license before redistributing the data.
- Text moderation model: [distilbert-multilingual-toxicity-classifier-ONNX](https://huggingface.co/onnx-community/distilbert-multilingual-toxicity-classifier-ONNX), downloaded at setup time. See its model card for license terms.
- Images in `client/src/tiles/` are generic stock images. Confirm their license before redistributing, or replace them with your own.

## License

Released under the [MIT License](LICENSE).
