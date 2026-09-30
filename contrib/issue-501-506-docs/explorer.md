# Explorer

The Vellar Explorer is an indexing service for network activity. 

**Note on Browsable UI:**
Currently, `vellar-explorer` serves purely as an API and **does not serve a root webpage or browsable UI**. Visiting the root URL (`/`) will return an `HTTP 404`.

## Available Endpoints

The following paths are currently active on the production Railway deployment:

- `GET /health` — Returns `200 OK` if the service is running and connected to Horizon.

*Note: Paths such as `/explorer`, `/tx`, `/api/health`, and `/docs` are not yet implemented and will return `404 Not Found`.*