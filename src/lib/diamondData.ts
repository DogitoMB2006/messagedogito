import { insforge, isInsforgeConfigured } from './insforge';

export type DiamondRow = { balance: number };
export type DecorationRow = { owned_ids: string[]; active_id: string | null };
export type AdWatchRow = { watched_at: string };
export type SenderDecorationRow = { user_id: string; active_id: string | null };

async function ensureDiamondRow(uid: string) {
  const { data } = await insforge.database
    .from('user_diamonds')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (!data) {
    await insforge.database.from('user_diamonds').insert([{ user_id: uid, balance: 0 }]);
  }
}

async function ensureDecorationRow(uid: string) {
  const { data } = await insforge.database
    .from('user_decorations')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (!data) {
    await insforge.database
      .from('user_decorations')
      .insert([{ user_id: uid, owned_ids: [], active_id: null }]);
  }
}

export async function loadDiamondEconomy(uid: string) {
  await Promise.all([ensureDiamondRow(uid), ensureDecorationRow(uid)]);

  const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const [{ data: dRow }, { data: decRow }, { data: adRows }] = await Promise.all([
    insforge.database.from('user_diamonds').select('balance').eq('user_id', uid).maybeSingle(),
    insforge.database.from('user_decorations').select('owned_ids, active_id').eq('user_id', uid).maybeSingle(),
    insforge.database
      .from('ad_watches')
      .select('watched_at')
      .eq('user_id', uid)
      .gte('watched_at', windowStart),
  ]);

  return {
    balance: dRow?.balance ?? 0,
    owned_ids: decRow?.owned_ids ?? [],
    active_id: decRow?.active_id ?? null,
    adCount: adRows?.length ?? 0,
  };
}

export async function loadSenderDecorations(ids: string[]) {
  if (ids.length === 0) return {} as Record<string, string | null>;

  const { data } = await insforge.database
    .from('user_decorations')
    .select('user_id, active_id')
    .in('user_id', ids);

  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as SenderDecorationRow[]) {
    map[row.user_id] = row.active_id ?? null;
  }
  for (const id of ids) {
    if (!(id in map)) map[id] = null;
  }
  return map;
}

export async function recordAdWatchAndAwardDiamond(uid: string, nextBalance: number) {
  await insforge.database.from('ad_watches').insert([{ user_id: uid }]);
  const { data: existing } = await insforge.database
    .from('user_diamonds')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (existing) {
    await insforge.database.from('user_diamonds').update({ balance: nextBalance }).eq('user_id', uid);
  } else {
    await insforge.database.from('user_diamonds').insert([{ user_id: uid, balance: nextBalance }]);
  }
}

export async function purchaseDecoration(
  uid: string,
  newBalance: number,
  newOwned: string[],
  activeId: string | null,
): Promise<{ error: string | null }> {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    insforge.database.from('user_diamonds').update({ balance: newBalance }).eq('user_id', uid),
    insforge.database
      .from('user_decorations')
      .update({ owned_ids: newOwned, active_id: activeId })
      .eq('user_id', uid),
  ]);
  if (e1 || e2) return { error: 'Purchase failed, try again' };
  return { error: null };
}

export async function saveActiveDecoration(
  uid: string,
  ownedIds: string[],
  decorId: string | null,
) {
  const { data: existing } = await insforge.database
    .from('user_decorations')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (existing) {
    await insforge.database
      .from('user_decorations')
      .update({ owned_ids: ownedIds, active_id: decorId })
      .eq('user_id', uid);
  } else {
    await insforge.database
      .from('user_decorations')
      .insert([{ user_id: uid, owned_ids: ownedIds, active_id: decorId }]);
  }
}

export { isInsforgeConfigured };
