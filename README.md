# Grindstone Dashboard

Internal web hub for Grindstone Concrete admin work — job/estimate tracking, billing,
scheduling, and timesheets-to-payroll. Replaces the old Google Sheets + Apps Script
production system.

Built with Vite + React + TypeScript, backed by Supabase (Postgres + Auth), deployed
on Vercel with auto-deploy on push to `main`.

Full project context, schema, and roadmap live outside this repo in the JobBox vault
(`projects/grindstone-dashboard/`), since they contain business-sensitive details not
meant for a (currently private, but portable) git history.

## Local dev

```
npm install
npm run dev
```

Requires a `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see
`.env.example`).
