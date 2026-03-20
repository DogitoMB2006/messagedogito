import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Loader2, Pencil, Search, Shield, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Avatar } from '../ui/avatar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';
import { notifyUserChatListRefresh } from '../../lib/notifyChatListRefresh';

type Tab = 'members' | 'invite' | 'roles';

interface MemberRow {
  user_id: string;
  group_role_id: string | null;
  users: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
}

interface RoleRow {
  id: string;
  name: string;
  can_kick: boolean;
  can_edit_group_profile: boolean;
  can_delete_others_messages: boolean;
}

interface FriendOption {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface GroupManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  friends: FriendOption[];
  /** Owner always can kick; moderators with kick permission too */
  canKickMembers: boolean;
  isOwner: boolean;
  onChanged?: () => void;
  /** Realtime: notify everyone in the chat to refresh membership & roles without reload */
  onSyncPeers?: () => void;
  /** After owner deletes the group (navigate away, etc.) */
  onGroupDeleted?: () => void;
}

export function GroupManageModal({
  isOpen,
  onClose,
  chatId,
  friends,
  canKickMembers,
  isOwner,
  onChanged,
  onSyncPeers,
  onGroupDeleted,
}: GroupManageModalProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('members');
  const [loading, setLoading] = useState(true);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [roleName, setRoleName] = useState('');
  const [permKick, setPermKick] = useState(false);
  const [permProfile, setPermProfile] = useState(false);
  const [permDelete, setPermDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editPermKick, setEditPermKick] = useState(false);
  const [editPermProfile, setEditPermProfile] = useState(false);
  const [editPermDelete, setEditPermDelete] = useState(false);

  const load = useCallback(async () => {
    if (!chatId || !user) return;
    setLoading(true);
    const { data: chat } = await supabase.from('chats').select('owner_id').eq('id', chatId).single();
    setOwnerId(chat?.owner_id ?? null);

    const { data: partData } = await supabase
      .from('chat_participants')
      .select('user_id, group_role_id, users:users(id, display_name, username, avatar_url)')
      .eq('chat_id', chatId);

    const normalized: MemberRow[] = (partData || []).map((row: any) => ({
      user_id: row.user_id,
      group_role_id: row.group_role_id,
      users: Array.isArray(row.users) ? row.users[0] : row.users,
    }));
    setMembers(normalized);

    const { data: roleData } = await supabase.from('group_roles').select('*').eq('chat_id', chatId).order('created_at');
    setRoles((roleData as RoleRow[]) || []);
    setLoading(false);
  }, [chatId, user]);

  useEffect(() => {
    if (isOpen) {
      void load();
      setTab('members');
      setInviteSearch('');
      setRoleName('');
      setPermKick(false);
      setPermProfile(false);
      setPermDelete(false);
      setEditingRoleId(null);
    }
  }, [isOpen, load]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const inviteCandidates = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase();
    return friends.filter((f) => {
      if (memberIds.has(f.id)) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q);
    });
  }, [friends, memberIds, inviteSearch]);

  const transferOwnership = async (targetId: string, displayName: string) => {
    if (
      !window.confirm(
        `Transfer ownership to ${displayName}? You will stay in the group as a member, but only the new owner can delete the group, invite people, and manage roles.`,
      )
    ) {
      return;
    }
    setBusy(`xfer-${targetId}`);
    try {
      const { error } = await supabase.rpc('transfer_group_ownership', {
        p_chat_id: chatId,
        p_new_owner_id: targetId,
      });
      if (error) throw error;
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not transfer ownership. Run supabase/group_owner_transfer_and_delete.sql if this is new.');
    } finally {
      setBusy(null);
    }
  };

  const deleteGroup = async () => {
    if (
      !window.confirm(
        'Delete this group for everyone? All messages and members will be removed. This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy('delete-group');
    try {
      const { error } = await supabase.rpc('delete_group_chat', { p_chat_id: chatId });
      if (error) throw error;
      onClose();
      onGroupDeleted?.();
    } catch (e) {
      console.error(e);
      alert('Could not delete the group. Run supabase/group_owner_transfer_and_delete.sql if this is new.');
    } finally {
      setBusy(null);
    }
  };

  const kick = async (targetId: string) => {
    if (!window.confirm('Remove this member from the group?')) return;
    setBusy(`kick-${targetId}`);
    try {
      const { error } = await supabase.rpc('remove_from_group', {
        p_chat_id: chatId,
        p_target_user_id: targetId,
      });
      if (error) throw error;
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not remove member.');
    } finally {
      setBusy(null);
    }
  };

  const invite = async (targetId: string) => {
    setBusy(`inv-${targetId}`);
    try {
      const { error } = await supabase.rpc('invite_to_group', {
        p_chat_id: chatId,
        p_user_id: targetId,
      });
      if (error) throw error;
      await load();
      onChanged?.();
      onSyncPeers?.();
      await notifyUserChatListRefresh(targetId);
    } catch (e) {
      console.error(e);
      alert('Could not invite user.');
    } finally {
      setBusy(null);
    }
  };

  const startEditRole = (r: RoleRow) => {
    setEditingRoleId(r.id);
    setEditRoleName(r.name);
    setEditPermKick(r.can_kick);
    setEditPermProfile(r.can_edit_group_profile);
    setEditPermDelete(r.can_delete_others_messages);
  };

  const cancelEditRole = () => {
    setEditingRoleId(null);
  };

  const saveEditRole = async () => {
    if (!editingRoleId || !editRoleName.trim()) return;
    setBusy(`edit-role-${editingRoleId}`);
    try {
      const { error } = await supabase
        .from('group_roles')
        .update({
          name: editRoleName.trim(),
          can_kick: editPermKick,
          can_edit_group_profile: editPermProfile,
          can_delete_others_messages: editPermDelete,
        })
        .eq('id', editingRoleId)
        .eq('chat_id', chatId);
      if (error) throw error;
      cancelEditRole();
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not update role.');
    } finally {
      setBusy(null);
    }
  };

  const assignRole = async (userId: string, roleId: string | null) => {
    setBusy(`role-${userId}`);
    try {
      const { error } = await supabase.rpc('assign_group_member_role', {
        p_chat_id: chatId,
        p_user_id: userId,
        p_role_id: roleId,
      });
      if (error) throw error;
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not update role.');
    } finally {
      setBusy(null);
    }
  };

  const createRole = async () => {
    const n = roleName.trim();
    if (!n) return;
    setBusy('create-role');
    try {
      const { error } = await supabase.from('group_roles').insert({
        chat_id: chatId,
        name: n,
        can_kick: permKick,
        can_edit_group_profile: permProfile,
        can_delete_others_messages: permDelete,
      });
      if (error) throw error;
      setRoleName('');
      setPermKick(false);
      setPermProfile(false);
      setPermDelete(false);
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not create role.');
    } finally {
      setBusy(null);
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!window.confirm('Delete this role? Members using it will lose the role.')) return;
    setBusy(`del-role-${roleId}`);
    try {
      const { error } = await supabase.from('group_roles').delete().eq('id', roleId).eq('chat_id', chatId);
      if (error) throw error;
      await load();
      onChanged?.();
      onSyncPeers?.();
    } catch (e) {
      console.error(e);
      alert('Could not delete role.');
    } finally {
      setBusy(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'members', label: 'Members', icon: Users },
    { id: 'invite', label: 'Invite', icon: UserPlus },
    { id: 'roles', label: 'Roles', icon: Shield },
  ];

  const currentUserIsOwner = isOwner && user?.id === ownerId;
  const moderatorKickOnly = !currentUserIsOwner && canKickMembers;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={moderatorKickOnly ? 'Members' : 'Group settings'}
      description={!moderatorKickOnly ? 'Manage members, invites, and custom roles for this group.' : undefined}
      className="max-w-lg max-h-[90vh] flex flex-col"
    >
      {!moderatorKickOnly && (
        <div className="flex gap-1 p-1 rounded-xl bg-secondary/30 mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors',
                tab === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-y-auto custom-scrollbar flex-1 min-h-[280px] max-h-[60vh]">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={moderatorKickOnly ? 'mod' : tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {(moderatorKickOnly || tab === 'members') && (
                <div className="space-y-2">
                  {members.map((m) => {
                    const u = m.users;
                    const label = u?.display_name || u?.username || m.user_id.slice(0, 8);
                    const isRowOwner = m.user_id === ownerId;
                    return (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-secondary/10"
                      >
                        <Avatar fallback={label} src={u?.avatar_url ?? undefined} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {isRowOwner ? 'Owner' : m.group_role_id ? 'Custom role' : 'Member'}
                          </p>
                        </div>
                        {!isRowOwner && currentUserIsOwner && (
                          <button
                            type="button"
                            onClick={() => void transferOwnership(m.user_id, label)}
                            disabled={busy !== null}
                            className="p-2 rounded-lg text-amber-500 hover:bg-amber-500/10 border border-amber-500/25 shrink-0"
                            title="Make owner"
                          >
                            {busy === `xfer-${m.user_id}` ? (
                              <Loader2 className="animate-spin" size={16} />
                            ) : (
                              <Crown size={16} />
                            )}
                          </button>
                        )}
                        {!isRowOwner && (currentUserIsOwner || canKickMembers) && (
                          <div className="flex items-center gap-2 shrink-0">
                            {currentUserIsOwner && (
                              <select
                                className="text-xs bg-background border border-border/50 rounded-lg px-2 py-1.5 max-w-[120px]"
                                value={m.group_role_id || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  void assignRole(m.user_id, v === '' ? null : v);
                                }}
                                disabled={busy !== null}
                              >
                                <option value="">Member</option>
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() => void kick(m.user_id)}
                              disabled={busy !== null}
                              className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/20"
                              title="Remove"
                            >
                              {busy === `kick-${m.user_id}` ? (
                                <Loader2 className="animate-spin" size={16} />
                              ) : (
                                <UserMinus size={16} />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {currentUserIsOwner && (
                    <div className="mt-6 pt-4 border-t border-red-500/20 space-y-2">
                      <p className="text-xs font-semibold text-red-400/90 uppercase tracking-wide">Danger zone</p>
                      <p className="text-xs text-muted-foreground">
                        Only you can delete this group. All members will lose access and all messages will be deleted.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void deleteGroup()}
                        className="w-full gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        {busy === 'delete-group' ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                        Delete group for everyone
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {tab === 'invite' && currentUserIsOwner && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search friends..."
                      className="pl-9 h-10 bg-secondary/30 border-border/50 rounded-xl"
                      value={inviteSearch}
                      onChange={(e) => setInviteSearch(e.target.value)}
                    />
                  </div>
                  {inviteCandidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No friends to invite.</p>
                  ) : (
                    inviteCandidates.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-secondary/10"
                      >
                        <Avatar fallback={f.name} src={f.avatarUrl ?? undefined} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{f.name}</p>
                          <p className="text-xs text-primary/80">@{f.username}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void invite(f.id)}
                          className="gap-1 shrink-0"
                        >
                          {busy === `inv-${f.id}` ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
                          Add
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'invite' && !currentUserIsOwner && (
                <p className="text-sm text-muted-foreground text-center py-12">Only the owner can invite members.</p>
              )}

              {tab === 'roles' && currentUserIsOwner && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl border border-border/40 bg-secondary/10 space-y-3">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wide">New role</p>
                    <Input
                      placeholder="Role name"
                      className="h-10 bg-background/50"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                    />
                    <div className="space-y-2 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={permKick} onChange={(e) => setPermKick(e.target.checked)} />
                        Kick members
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={permProfile} onChange={(e) => setPermProfile(e.target.checked)} />
                        Edit group name, photo & bio
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={permDelete} onChange={(e) => setPermDelete(e.target.checked)} />
                        Delete others&apos; messages
                      </label>
                    </div>
                    <Button type="button" disabled={!roleName.trim() || busy !== null} onClick={() => void createRole()}>
                      {busy === 'create-role' ? <Loader2 className="animate-spin" size={16} /> : 'Create role'}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Existing roles</p>
                    {roles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No custom roles yet.</p>
                    ) : (
                      roles.map((r) => (
                        <div
                          key={r.id}
                          className="p-3 rounded-xl border border-border/30 bg-background/40 space-y-3"
                        >
                          {editingRoleId === r.id ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Edit role</p>
                                <button
                                  type="button"
                                  onClick={cancelEditRole}
                                  className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"
                                  aria-label="Cancel edit"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                              <Input
                                className="h-10 bg-background/50"
                                value={editRoleName}
                                onChange={(e) => setEditRoleName(e.target.value)}
                              />
                              <div className="space-y-2 text-sm">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editPermKick}
                                    onChange={(e) => setEditPermKick(e.target.checked)}
                                  />
                                  Kick members
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editPermProfile}
                                    onChange={(e) => setEditPermProfile(e.target.checked)}
                                  />
                                  Edit group name, photo & bio
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editPermDelete}
                                    onChange={(e) => setEditPermDelete(e.target.checked)}
                                  />
                                  Delete others&apos; messages
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={!editRoleName.trim() || busy !== null}
                                  onClick={() => void saveEditRole()}
                                >
                                  {busy === `edit-role-${r.id}` ? <Loader2 className="animate-spin" size={14} /> : 'Save'}
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={cancelEditRole}>
                                  Cancel
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-sm">{r.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-1 space-x-2">
                                  {r.can_kick && <span>Kick</span>}
                                  {r.can_edit_group_profile && <span>Profile</span>}
                                  {r.can_delete_others_messages && <span>Delete msgs</span>}
                                  {!r.can_kick && !r.can_edit_group_profile && !r.can_delete_others_messages && (
                                    <span>No extra permissions</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => startEditRole(r)}
                                  disabled={busy !== null}
                                  className="p-2 rounded-lg text-primary hover:bg-primary/10 border border-primary/20"
                                  title="Edit role"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteRole(r.id)}
                                  disabled={busy !== null}
                                  className="text-xs text-red-400 hover:underline"
                                >
                                  {busy === `del-role-${r.id}` ? '…' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'roles' && !currentUserIsOwner && (
                <p className="text-sm text-muted-foreground text-center py-12">Only the owner can manage roles.</p>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Modal>
  );
}
