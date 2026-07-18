import { insforge } from './insforge';

const SESSION_KEY = 'dogito.insforge.session';
const AUTH_EVENT = 'dogito:insforge-auth-change';

type StoredSession = {
  accessToken: string;
  user: any;
};

type RealtimeHandler = {
  kind: 'broadcast' | 'postgres_changes';
  config: any;
  callback: (payload: any) => void;
  eventName?: string;
  wrapped?: (message: any) => void;
};

type QueryArrayResult = { data: any[] | null; error: any; count?: number };
type QuerySingleResult = { data: any | null; error: any; count?: number };
type QueryBuilder = PromiseLike<QueryArrayResult> & {
  select: (...args: any[]) => QueryBuilder;
  insert: (...args: any[]) => QueryBuilder;
  update: (...args: any[]) => QueryBuilder;
  upsert: (...args: any[]) => QueryBuilder;
  delete: (...args: any[]) => QueryBuilder;
  eq: (...args: any[]) => QueryBuilder;
  neq: (...args: any[]) => QueryBuilder;
  in: (...args: any[]) => QueryBuilder;
  is: (...args: any[]) => QueryBuilder;
  gte: (...args: any[]) => QueryBuilder;
  lte: (...args: any[]) => QueryBuilder;
  order: (...args: any[]) => QueryBuilder;
  limit: (...args: any[]) => QueryBuilder;
  or: (...args: any[]) => QueryBuilder;
  single: (...args: any[]) => Promise<QuerySingleResult>;
  maybeSingle: (...args: any[]) => Promise<QuerySingleResult>;
};

type SupabaseCompat = {
  auth: {
    getSession: () => Promise<{ data: { session: any }; error: any }>;
    onAuthStateChange: (
      callback: (event: string, session: any) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ data: any; error: any }>;
    signUp: (request: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => Promise<{ data: any; error: any }>;
    verifyEmail: (request: { email: string; otp: string }) => Promise<{ data: any; error: any }>;
    signOut: () => Promise<{ error: any }>;
  };
  from: (table: string) => QueryBuilder;
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<QuerySingleResult>;
  functions: { invoke: (slug: string, options?: any) => Promise<{ data: any; error: any }> };
  storage: any;
  channel: (name: string, options?: any) => InsForgeCompatChannel;
  removeChannel: (channel: InsForgeCompatChannel) => Promise<void>;
};

const storageUrlCache = new Map<string, string>();

function storageCacheKey(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

function buildStorageUrl(bucket: string, path: string) {
  const baseUrl = import.meta.env.VITE_INSFORGE_URL?.replace(/\/$/, '') || '';
  return `${baseUrl}/api/storage/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(path)}`;
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.accessToken || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore storage failures */
  }
}

function emitAuthChange(event: string, session: any) {
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { event, session } }));
}

function sessionFromUser(user: any, accessToken?: string | null) {
  if (!user) return null;
  return {
    access_token: accessToken ?? loadStoredSession()?.accessToken ?? null,
    accessToken: accessToken ?? loadStoredSession()?.accessToken ?? null,
    user,
  };
}

const stored = loadStoredSession();
if (stored?.accessToken) {
  insforge.setAccessToken(stored.accessToken);
}

function rowMatchesFilter(row: Record<string, unknown> | null | undefined, filter?: string) {
  if (!filter || !row) return true;
  const eqMatch = filter.match(/^([a-zA-Z0-9_]+)=eq\.(.+)$/);
  if (eqMatch) {
    return String(row[eqMatch[1]]) === eqMatch[2];
  }
  const inMatch = filter.match(/^([a-zA-Z0-9_]+)=in\.\((.*)\)$/);
  if (inMatch) {
    const values = inMatch[2].split(',').map((value) => value.trim()).filter(Boolean);
    return values.includes(String(row[inMatch[1]]));
  }
  return true;
}

function stripMeta(message: any) {
  if (!message || typeof message !== 'object') return message;
  const { meta: _meta, ...payload } = message;
  return payload;
}

async function ensureRealtimeConnected() {
  if (insforge.realtime.connectionState === 'connected') return;
  await insforge.realtime.connect();
}

class InsForgeCompatChannel {
  private handlers: RealtimeHandler[] = [];
  private subscribedChannels = new Set<string>();
  private subscribed = false;

  constructor(private readonly name: string) {}

  on(kind: 'broadcast' | 'postgres_changes', config: any, callback: (payload: any) => void) {
    this.handlers.push({ kind, config, callback });
    return this;
  }

  subscribe(callback?: (status: string) => void, _timeoutMs?: number) {
    void this.start(callback);
    return this;
  }

  async start(callback?: (status: string) => void) {
    if (this.subscribed) {
      callback?.('SUBSCRIBED');
      return this;
    }
    this.subscribed = true;

    try {
      await ensureRealtimeConnected();
      await this.subscribeChannel(this.name);

      for (const handler of this.handlers) {
        if (handler.kind === 'broadcast') {
          const event = handler.config?.event;
          handler.eventName = event;
          handler.wrapped = (message: any) => {
            if (message?.meta?.channel && message.meta.channel !== this.name) return;
            handler.callback({ payload: stripMeta(message) });
          };
          insforge.realtime.on(event, handler.wrapped);
          continue;
        }

        const table = handler.config?.table;
        if (!table) continue;
        const dbChannel = `db:${table}`;
        const event = `postgres_changes:${table}`;
        await this.subscribeChannel(dbChannel);
        handler.eventName = event;
        handler.wrapped = (message: any) => {
          if (message?.meta?.channel && message.meta.channel !== dbChannel) return;
          const payload = stripMeta(message);
          const wanted = handler.config?.event || '*';
          if (wanted !== '*' && payload.eventType !== wanted) return;
          const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
          if (!rowMatchesFilter(row, handler.config?.filter)) return;
          handler.callback(payload);
        };
        insforge.realtime.on(event, handler.wrapped);
      }

      callback?.('SUBSCRIBED');
    } catch (error) {
      console.warn('InsForge realtime subscribe failed', error);
      callback?.('CHANNEL_ERROR');
    }

    return this;
  }

  async send(message: { type?: string; event: string; payload?: Record<string, unknown> }) {
    await ensureRealtimeConnected();
    await this.subscribeChannel(this.name);
    await insforge.realtime.publish(this.name, message.event, message.payload ?? {});
    return 'ok';
  }

  async httpSend(event: string, payload?: Record<string, unknown>) {
    return this.send({ type: 'broadcast', event, payload });
  }

  async unsubscribe() {
    for (const handler of this.handlers) {
      if (handler.eventName && handler.wrapped) {
        insforge.realtime.off(handler.eventName, handler.wrapped);
      }
    }
    for (const channel of this.subscribedChannels) {
      insforge.realtime.unsubscribe(channel);
    }
    this.subscribedChannels.clear();
    this.subscribed = false;
  }

  private async subscribeChannel(channel: string) {
    if (this.subscribedChannels.has(channel)) return;
    const response = await insforge.realtime.subscribe(channel);
    if (!response.ok) {
      throw new Error(response.error?.message || `Could not subscribe to ${channel}`);
    }
    this.subscribedChannels.add(channel);
  }
}

class InsForgeCompatStorageBucket {
  constructor(private readonly bucket: string) {}

  async upload(path: string, file: File | Blob, _options?: Record<string, unknown>) {
    const { data, error } = await insforge.storage.from(this.bucket).upload(path, file);
    if (data?.url) {
      storageUrlCache.set(storageCacheKey(this.bucket, path), data.url);
      storageUrlCache.set(storageCacheKey(this.bucket, data.key), data.url);
    }
    return { data, error };
  }

  getPublicUrl(path: string) {
    const publicUrl = storageUrlCache.get(storageCacheKey(this.bucket, path)) || buildStorageUrl(this.bucket, path);
    return { data: { publicUrl } };
  }

  async remove(paths: string | string[]) {
    const list = Array.isArray(paths) ? paths : [paths];
    const results = await Promise.all(list.map((path) => insforge.storage.from(this.bucket).remove(path)));
    const error = results.find((result) => result.error)?.error ?? null;
    if (!error) {
      for (const path of list) storageUrlCache.delete(storageCacheKey(this.bucket, path));
    }
    return { data: error ? null : { message: 'Object deleted successfully' }, error };
  }

  download(path: string) {
    return insforge.storage.from(this.bucket).download(path);
  }
}

const insforgeStorage = {
  from(bucket: string) {
    return new InsForgeCompatStorageBucket(bucket);
  },
};

export const supabase: SupabaseCompat = {
  auth: {
    async getSession() {
      const storedSession = loadStoredSession();
      if (storedSession?.accessToken) {
        insforge.setAccessToken(storedSession.accessToken);
      }

      const { data, error } = await insforge.auth.getCurrentUser();
      if (error || !data?.user) {
        saveStoredSession(null);
        insforge.setAccessToken(null);
        return { data: { session: null }, error };
      }

      const session = sessionFromUser(data.user, storedSession?.accessToken ?? null);
      if (storedSession?.accessToken) saveStoredSession({ accessToken: storedSession.accessToken, user: data.user });
      return { data: { session }, error: null };
    },

    onAuthStateChange(callback: (event: string, session: any) => void) {
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ event: string; session: any }>).detail;
        callback(detail.event, detail.session);
      };
      window.addEventListener(AUTH_EVENT, listener);
      return {
        data: {
          subscription: {
            unsubscribe: () => window.removeEventListener(AUTH_EVENT, listener),
          },
        },
      };
    },

    async signInWithPassword(credentials: { email: string; password: string }) {
      const { data, error } = await insforge.auth.signInWithPassword(credentials);
      if (!error && data?.accessToken && data.user) {
        saveStoredSession({ accessToken: data.accessToken, user: data.user });
        insforge.setAccessToken(data.accessToken);
        emitAuthChange('SIGNED_IN', sessionFromUser(data.user, data.accessToken));
      }
      return { data, error };
    },

    async signUp(request: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
      const profile = request.options?.data ?? {};
      const name = String(profile.display_name || profile.username || request.email.split('@')[0] || '').trim();
      const { data, error } = await insforge.auth.signUp({
        email: request.email,
        password: request.password,
        name,
      });

      if (!error && data?.accessToken && data.user) {
        saveStoredSession({ accessToken: data.accessToken, user: data.user });
        insforge.setAccessToken(data.accessToken);
        emitAuthChange('SIGNED_IN', sessionFromUser(data.user, data.accessToken));
      }

      return { data, error };
    },

    async verifyEmail(request: { email: string; otp: string }) {
      const { data, error } = await insforge.auth.verifyEmail(request);
      if (!error && data?.accessToken && data.user) {
        saveStoredSession({ accessToken: data.accessToken, user: data.user });
        insforge.setAccessToken(data.accessToken);
        emitAuthChange('SIGNED_IN', sessionFromUser(data.user, data.accessToken));
      }
      return { data, error };
    },

    async signOut() {
      const result = await insforge.auth.signOut();
      saveStoredSession(null);
      insforge.setAccessToken(null);
      emitAuthChange('SIGNED_OUT', null);
      return result;
    },
  },

  from(table: string) {
    return insforge.database.from(table) as unknown as QueryBuilder;
  },

  rpc(functionName: string, args?: Record<string, unknown>) {
    return insforge.database.rpc(functionName, args) as unknown as Promise<QuerySingleResult>;
  },

  functions: {
    invoke(slug: string, options?: any) {
      return insforge.functions.invoke(slug, options);
    },
  },

  storage: insforgeStorage,

  channel(name: string, _options?: any) {
    return new InsForgeCompatChannel(name);
  },

  async removeChannel(channel: InsForgeCompatChannel) {
    await channel.unsubscribe();
  },
};
