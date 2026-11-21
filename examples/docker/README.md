# Validate container environment variables with Docker and Compose

`env-saaf` validates `process.env` when the container process starts, regardless of how Docker or Docker Compose supplied those variables. This example boots cleanly with a valid `.env` file and exits immediately with code `1` on invalid values.

## Run with a valid config

From the repository root:

```sh
cd examples/docker
docker compose --env-file .env.example up --build --exit-code-from app
```

The container validates the environment and prints:

```text
Started env-saaf-compose: port=3000 (number), debug=false (boolean), logLevel=info, apiUrl=https://api.example.com
```

## Fail fast with an invalid config

Pass `.env.bad.example` (which sets an invalid `PORT`, `APP_DEBUG`, and `API_URL`):

```sh
docker compose --env-file .env.bad.example up --exit-code-from app
```

`validateEnv` reports every problem at once on stderr and exits with code `1` before the app does any work:

```text
Invalid environment variables:
  - PORT: expected a port (0-65535, e.g. 3000), got "not-a-port"
  - APP_DEBUG: expected a boolean (e.g. true/false, yes/no, on/off, 1/0, y/n), got "maybe"
  - API_URL: expected a valid URL (e.g. https://example.com), got "not-a-url"
```

Clean up the example container when finished:

```sh
docker compose down
```

## How `env-saaf` sees the three container env mechanisms

`validateEnv` reads the final `process.env` inside the running container:

- **Dockerfile `ENV`**: Baked into the image at build time (such as `ENV LOG_LEVEL=info` here) and always present in `process.env` unless overridden at runtime. Use it only for safe non-secret defaults, never credentials.
- **`--env-file`**: With `docker run --env-file .env <image>`, Docker injects every key from the file directly into the container's `process.env`, overriding matching `ENV` defaults. With `docker compose --env-file .env up`, Compose uses the file for `${VAR}` substitution in `compose.yaml`, so variables still need to be forwarded under `environment:` (or loaded via service-level `env_file:`) to reach the container.
- **Compose `environment:`**: Sets or overrides variables directly in the service container's `process.env`, either as literal values (`APP_NAME: env-saaf-compose`) or expanded from `--env-file` (`PORT: ${PORT:-}`). Entries here take precedence over both image `ENV` and service `env_file:`.
