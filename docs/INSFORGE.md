# InsForge backend (DogitoChat)

## Strategy

InsForge is the source of truth for auth, chat, friends, realtime, functions, voice calls, push tokens, storage, and the diamonds/decorations economy.

InsForge Storage buckets used by the app:
- `chatimages`
- `bucket`
- `stickers`

The app keeps a small compatibility adapter at `src/lib/supabase.ts` so existing call sites can keep using `supabase.from(...)`, `supabase.auth...`, `supabase.channel(...)`, and `supabase.storage...`. Every adapter path routes to InsForge.

## Environment

```bash
VITE_INSFORGE_URL=https://u8tfq8ai.us-east.insforge.app
VITE_INSFORGE_ANON_KEY=<InsForge anon key>
```

## Backend Workflow

Use the InsForge CLI for backend tasks:

```bash
npx @insforge/cli current
npx @insforge/cli db migrations up --all
npx @insforge/cli storage create-bucket chatimages
npx @insforge/cli storage create-bucket bucket
npx @insforge/cli storage create-bucket stickers
npx @insforge/cli functions deploy push-notify --file insforge/functions/push-notify.ts
```

The initial clean schema lives in `migrations/20260712225950_initial-insforge-backend.sql`.
