# Local react-country-state-city data

The application vendors the official `react-country-state-city` dataset during the Docker client build.

The package's current data files are:
- `countriesminified.json`
- `statesminified.json`
- `citiesminified.json`

They are stored in this directory and served locally at `/geo-data`. The React package helpers expect these exact filenames when a custom `src` is supplied.

Do not rename these files.
