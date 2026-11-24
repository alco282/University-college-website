# Docker-only setup

Node.js and npm are **not required on the host machine**.

From the project root, create/configure `.env` as usual, then run:

```bash
docker compose build
docker compose up -d
```

The client build stage automatically:

1. installs the client npm dependencies inside the temporary Node 20 build container;
2. runs `npm run vendor:geo-data`;
3. downloads the complete `react-country-state-city` country/state/city JSON dataset when it is not already present;
4. verifies that each response is JSON and non-empty;
5. records SHA-256 hashes and record counts in `client/public/geo-data/manifest.json`;
6. builds the React application; and
7. copies the resulting local geographic dataset into the production image.

The runtime browser therefore reads `/geo-data` from the application itself and does not need to contact GitHub for country/state/city data.

## Refreshing the geographic dataset

To force a fresh dataset during a Docker build:

```bash
docker compose build --no-cache --build-arg REACT_COUNTRY_STATE_CITY_REFRESH=1 app
docker compose up -d
```

The Dockerfile passes this build argument to the client build environment.

## Normal rebuild

```bash
docker compose build
docker compose up -d
```

No `npm install`, `npm run build`, or Node.js installation is required on the host.
