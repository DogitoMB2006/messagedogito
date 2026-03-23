import { createClient } from 'npm:@supabase/supabase-js@2';
import { JWT } from 'npm:google-auth-library@9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PushRequest = {
  chatId?: string;
  recipientUserIds?: string[];
  title?: string;
  body?: string;
  kind?: 'message' | 'incoming_call';
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function readEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function getAccessToken(): Promise<string> {
  const client = new JWT({
    email: readEnv('FIREBASE_CLIENT_EMAIL'),
    key: readEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const token = await client.authorize();
  if (!token.access_token) throw new Error('Could not fetch Firebase access token');
  return token.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = readEnv('SUPABASE_URL');
    const supabaseAnonKey = readEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const payload = (await req.json()) as PushRequest;
    const chatId = payload.chatId?.trim();
    const recipientUserIds = Array.from(new Set((payload.recipientUserIds ?? []).map(String))).filter(
      (id) => id && id !== user.id,
    );
    const title = payload.title?.trim();
    const body = payload.body?.trim();
    const kind = payload.kind === 'incoming_call' ? 'incoming_call' : 'message';

    if (!chatId || recipientUserIds.length === 0 || !title || !body) {
      return json({ error: 'Invalid payload' }, 400);
    }

    const { data: callerMembership } = await adminClient
      .from('chat_participants')
      .select('chat_id')
      .eq('chat_id', chatId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!callerMembership) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { data: participantRows } = await adminClient
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', chatId)
      .in('user_id', recipientUserIds);

    const allowedRecipientIds = new Set((participantRows ?? []).map((row) => String(row.user_id)));
    if (allowedRecipientIds.size === 0) {
      return json({ delivered: 0, skipped: recipientUserIds.length });
    }

    const { data: tokenRows } = await adminClient
      .from('push_tokens')
      .select('id, token, user_id')
      .in('user_id', Array.from(allowedRecipientIds))
      .eq('platform', 'android')
      .is('disabled_at', null);

    if (!tokenRows || tokenRows.length === 0) {
      return json({ delivered: 0, skipped: allowedRecipientIds.size });
    }

    const accessToken = await getAccessToken();
    const firebaseProjectId = readEnv('FIREBASE_PROJECT_ID');

    const responses = await Promise.all(
      tokenRows.map(async (tokenRow) => {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token: tokenRow.token,
                notification: { title, body },
                data: {
                  chatId,
                  kind,
                },
                android: {
                  priority: 'high',
                  notification: {
                    channel_id: kind === 'incoming_call' ? 'calls' : 'messages',
                    click_action: 'OPEN_ACTIVITY_1',
                    default_sound: true,
                    notification_priority: kind === 'incoming_call' ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
                  },
                },
              },
            }),
          },
        );

        if (response.ok) {
          return { ok: true, tokenId: tokenRow.id };
        }

        const errorText = await response.text();
        if (errorText.includes('UNREGISTERED') || errorText.includes('registration-token-not-registered')) {
          await adminClient
            .from('push_tokens')
            .update({ disabled_at: new Date().toISOString() })
            .eq('id', tokenRow.id);
        }

        return { ok: false, tokenId: tokenRow.id, errorText };
      }),
    );

    const delivered = responses.filter((entry) => entry.ok).length;
    const failed = responses.filter((entry) => !entry.ok).length;

    return json({ delivered, failed });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
