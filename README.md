# School Management App

A Next.js 15 + Supabase school management application for a Nigerian school workflow. The app is organized around admin, teacher, student, and parent roles, with a notebook-style UI and data-driven pages for academics, attendance, fees, messaging, and report cards.

## Overview

This project is a full-stack school ERP-style web app built with:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth + Postgres + RLS
- Server actions for authenticated mutations

The app currently covers:

- Admin account lifecycle and password reset workflows
- Class, subject, timetable, and enrollment management
- Student and staff records
- Teacher lesson planning, attendance, assessments, and grade entry
- Curriculum notes with markdown + tables + Mermaid rendering
- Parent portal access for read-only child views
- Messaging and announcements
- Invoicing, payments, and printable receipts
- Report-card generation, ranking, and grading workflows

## Current status

The codebase is already beyond the early scaffold phase. The most recent work includes:

- security/correctness hardening pass: deactivated-user blocking at the middleware layer, an access guard on report-card reads, an overpayment guard on manual fee entry, and a timezone fix for library loan due dates
- report-card scoring now treats a subject as incomplete (rather than silently averaging over just the graded assessments) until every 1st CA / 2nd CA / Exam component has a grade
- centralized Supabase Storage bucket names instead of redeclaring them across several files
- stronger temporary-password generation and account-cleanup safeguards
- targeted role and RLS hardening across academic and parent flows
- announcement read-state UX polish
- shared toast feedback for save actions
- richer term/year selector syncing and dashboard polish

This README describes the current app state rather than the original starter-era behavior.

## Tech stack

**Core**

- [Next.js](https://nextjs.org/) 15 (App Router, Server Components, Server Actions)
- [React](https://react.dev/) 18
- [TypeScript](https://www.typescriptlang.org/) 5
- [Tailwind CSS](https://tailwindcss.com/) 3

**Backend & data**

- [Supabase](https://supabase.com/) — Postgres, Auth, Storage, and Row Level Security
- `@supabase/ssr` + `@supabase/supabase-js` for server/browser Supabase clients
- [Zod](https://zod.dev/) for server-side env and input validation
- Custom Next.js middleware (`middleware.ts`) for auth/role gating and forced-password-change redirects

**Rich content & editing**

- [Tiptap](https://tiptap.dev/) (ProseMirror-based) for the curriculum note editor — tables, task lists, text alignment, subscript/superscript, and Markdown import/export via `tiptap-markdown`
- [react-markdown](https://github.com/remarkjs/react-markdown) + `remark-gfm` for rendering saved notes, with `rehype-highlight` / `highlight.js` for code blocks
- [isomorphic-dompurify](https://github.com/kkomelin/isomorphic-dompurify) for sanitizing rendered HTML

**Math & diagrams**

- [KaTeX](https://katex.org/) + `rehype-katex` / `remark-math` for inline and block math rendering
- [MathLive](https://cortexjs.io/mathlive/) for interactive math input in notes and quizzes
- [Mermaid](https://mermaid.js.org/) for flowcharts and diagrams embedded in curriculum notes

**Maps**

- [Leaflet](https://leafletjs.com/) + `react-leaflet` for transport route mapping

**Payments & email**

- [Paystack](https://paystack.com/) for online fee payments, verified server-side
- [Resend](https://resend.com/) for bulk email (announcements, fee reminders)

**Tooling**

- [Vitest](https://vitest.dev/) for unit tests (`lib/report-card-scoring.ts`, `types/database.ts`, and other pure logic)
- ESLint (`eslint-config-next`) + Prettier (`prettier-plugin-tailwindcss`) for linting/formatting
- `undici` for the server-side fetch dispatcher used by the Supabase client wrapper

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a local environment file with the Supabase and Paystack values used by the app.

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=your-paystack-public-key
PAYSTACK_SECRET_KEY=your-paystack-secret-key
```

These values come from your Supabase project in the Project Settings → API section and your Paystack dashboard settings. `PAYSTACK_SECRET_KEY` is validated on startup (`lib/env.server.ts`) and must start with `sk_`.

Optional — only needed if you're testing bulk email (announcements, fee reminders):

```env
RESEND_API_KEY=your-resend-api-key
```

`RESEND_API_KEY` isn't part of the validated env schema, so the app runs fine without it; email sending will just fail when attempted.

### 3. Start the app

```bash
npm run dev
```

Then open:

```text
http://localhost:3000/login
```

## Available scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run format
npm run format:check
```

## Key product areas

### Admin

- Manage classes, subjects, staff, students, timetables, and school settings
- Create and reset user accounts
- Review moderation workflows and fee/invoice operations

### Teacher

- Create lesson plans from timetable slots
- Take attendance
- Create assessments and enter grades
- Author curriculum notes with draft/published status

### Student and parent

- View subject and topic materials
- Access schedule, attendance, grades, fees, report cards, announcements, and messages
- Parent accounts can switch across linked children

### Fees and receipts

- Fee structures and invoice generation
- Manual payment recording
- Paystack integration with server-side verification
- Printable receipt pages

### Reporting

- Subject scoring from graded assessments (weighted by explicit `weight_percent`, or by `max_score` ratios for the standard CA + Exam set), only once every assessment for that subject has a grade
- Report-card generation
- Class ranking and grade moderation support

## Project structure

```text
app/                  — App Router pages and role-driven dashboard routes
components/          — reusable UI components and forms
lib/                 — server actions, helpers, validators, and Supabase integration
types/               — shared database typing
middleware.ts        — Next.js middleware: session refresh, role/auth gating, and
                       forced-password-change redirects on /dashboard, /login, and
                       /change-password (runs in every environment, not just locally)
```

## Notes for contributors

- The app uses Role-Based Access Control and Postgres RLS across many tables.
- Most page data is server rendered, while interactive pages stay in client components.
- The database typing file is maintained manually and should be kept aligned with the SQL schema.
- Work is tracked in the project todo list and should be reconciled with the actual codebase before being marked complete.
- **Migration files use a 14-digit timestamp prefix**:
  `YYYYMMDDHHMMSS_short_description.sql` (e.g.
  `20260920143000_add_hostel_curfew_flag.sql`). The Supabase CLI derives a
  migration's tracked "version" from the digits before the first
  underscore in its filename, so every file needs a unique, sortable one.
  Generate one with `date -u +%Y%m%d%H%M%S`, or let
  `supabase migration new <n>` generate the filename for you. Files that
  were originally named with an underscore-separated date
  (`2026_09_20_...`) were renamed to timestamps derived from that date so
  the whole directory replays in the right order; a project that already
  had them applied should mark the new versions as applied with
  `supabase migration repair --status applied <version>` rather than
  re-running them.

## License

This project is currently intended for internal or local development use within the workspace and is not yet packaged for public distribution. See [LICENSE](./LICENSE) for the full terms.
