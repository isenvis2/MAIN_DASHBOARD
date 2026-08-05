# Repository Guidelines

## Project Structure & Module Organization

This repository is a Windows-oriented dashboard suite. Application code lives under `apps/`: `main_dashboard` provides the static integration shell; `hls_converter` contains the Node API, Python FFmpeg manager, and viewer; `weather_dashboard` is Flask-based; `news_dashboard`, `sms_dashboard`, and `report_dashboard` use React/Vite with separate backends; and `event_dashboard` integrates with AxxonONE over gRPC. Shared runtime configuration and data are under `shared/config` and `shared/data`; generated HLS output belongs in `shared/media`. Operational batch files are in `infra/scripts`, while documentation and UI references are in `docs`.

## Build, Test, and Development Commands

- `infra\scripts\run_all.bat`: start all dashboards and wait for health checks.
- `infra\scripts\stop_all.bat`: stop the managed services.
- `infra\scripts\check_remote_ports.bat <server-ip>`: verify required LAN ports.
- `npm run dev` or `npm run build`: run/build Vite applications from their app directory, such as `apps\report_dashboard`.
- `npm run lint`: run TypeScript checking where the script exists.
- `python app.py`: run the weather service from `apps\weather_dashboard`.

Install dependencies within each application; there is no root package workspace. Consult `docs/README.md` for ports and environment setup.

## Coding Style & Naming Conventions

Preserve the existing local style: two-space indentation for JavaScript/TypeScript/JSON and four spaces for Python. Use `camelCase` for JavaScript functions and variables, `PascalCase` for React components and TypeScript types, and `snake_case` for Python. Keep API routes lowercase and resource-oriented. Place environment-specific values in JSON configuration or `.env`, not inline constants. Avoid unrelated formatting changes in large legacy files.

## Testing Guidelines

Automated coverage is currently limited. Before submitting, run applicable TypeScript checks, production builds, `node --check` on changed server files, and each affected `/api/health` endpoint. Add tests near the owning application using `*.test.ts`, `*.test.tsx`, or `test_*.py`. Prioritize report approval transitions, HLS restart/backoff behavior, and configuration sanitization.

## Commit & Pull Request Guidelines

Git history is unavailable in this package, so use concise imperative commits such as `fix(hls): prevent stale session restart`. Keep commits scoped to one service. Pull requests should describe affected apps, configuration changes, verification commands, rollback considerations, and linked issues. Include screenshots for UI changes and sanitized logs for streaming or integration fixes.

## Security & Configuration Tips

Never commit `.env` files, API keys, VMS credentials, RTSP passwords, generated media, or operational logs. Use `.env.example` with placeholders. Treat write APIs and services bound to `0.0.0.0` as LAN-exposed, and redact credentials from diagnostics and screenshots.
