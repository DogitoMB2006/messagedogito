import { useEffect, useState } from 'react';
import { Bell, BellOff, Calendar, Image as ImageIcon, Loader2, LogOut, Save, Users, X } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { LeaveGroupModal } from './LeaveGroupModal';

interface GroupProfileSidebarProps {
  chatId: string;
  onClose: () => void;
  /** After successful leave (clear URL / close panels). */
  onLeftGroup?: () => void;
}

export function GroupProfileSidebar({ chatId, onClose, onLeftGroup }: GroupProfileSidebarProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chat, setChat] = useState<any>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [muteToggling, setMuteToggling] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: row } = await supabase.from('chats').select('*').eq('id', chatId).single();
    setChat(row);
    setName(row?.name || '');
    setBio(row?.bio || '');

    const { count } = await supabase.from('chat_participants').select('*', { count: 'exact', head: true }).eq('chat_id', chatId);
    setMemberCount(count ?? 0);

    const { data: mine } = await supabase
      .from('chat_participants')
      .select('group_role_id, notifications_muted')
      .eq('chat_id', chatId)
      .eq('user_id', user.id)
      .maybeSingle();

    setNotificationsMuted(Boolean(mine?.notifications_muted));

    let rolePerm = false;
    if (mine?.group_role_id) {
      const { data: role } = await supabase.from('group_roles').select('can_edit_group_profile').eq('id', mine.group_role_id).maybeSingle();
      rolePerm = Boolean(role?.can_edit_group_profile);
    }
    const owner = row?.owner_id === user.id;
    setCanEdit(owner || rolePerm);
    setLoading(false);
  };

  const toggleMuteNotifications = async () => {
    if (!user || muteToggling) return;
    const next = !notificationsMuted;
    setMuteToggling(true);
    try {
      const { error } = await supabase.rpc('set_group_notifications_muted', {
        p_chat_id: chatId,
        p_muted: next,
      });
      if (error) throw error;
      setNotificationsMuted(next);
    } catch (e) {
      console.error(e);
      alert('Could not update notification settings. Verify the InsForge backend migration is applied.');
    } finally {
      setMuteToggling(false);
    }
  };

  useEffect(() => {
    void load();
  }, [chatId, user?.id]);

  const isGroupOwner = Boolean(user && chat?.owner_id === user.id);

  const confirmLeave = async () => {
    setLeaveLoading(true);
    try {
      const { error } = await supabase.rpc('leave_group', { p_chat_id: chatId });
      if (error) throw error;
      setLeaveOpen(false);
      onClose();
      onLeftGroup?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not leave the group.';
      alert(`${msg} Verify the InsForge backend migration is applied.`);
    } finally {
      setLeaveLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!canEdit || !name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('chats')
        .update({ name: name.trim(), bio: bio.trim() })
        .eq('id', chatId);
      if (error) throw error;
      await load();
    } catch (e) {
      console.error(e);
      alert('Could not save group profile.');
    } finally {
      setSaving(false);
    }
  };

  const onAvatarChange = async (file: File | null) => {
    if (!file || !user || !canEdit) return;
    setSaving(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `groups/${chatId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('chatimages').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('chatimages').getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('No public URL');
      const { error } = await supabase.from('chats').update({ avatar_url: pub.publicUrl }).eq('id', chatId);
      if (error) throw error;
      await load();
    } catch (e) {
      console.error(e);
      alert('Could not update photo.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-background/95 backdrop-blur-md justify-center items-center shadow-[-10px_0_30px_rgba(0,0,0,0.1)] text-primary">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!chat) return null;

  return (
    <div className="flex flex-col h-full bg-background/95 backdrop-blur-md overflow-y-auto custom-scrollbar shadow-[-10px_0_30px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between p-4 bg-background/40 backdrop-blur-md sticky top-0 z-20 border-b border-border/30">
        <h2 className="font-semibold text-foreground tracking-tight">Group</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-secondary text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative">
        <div className="h-28 w-full bg-gradient-to-tr from-primary/25 to-accent/20" />
        <div className="px-5 absolute -bottom-10 left-0">
          <label className={canEdit ? 'cursor-pointer group block' : 'block'}>
            <Avatar
              size="xl"
              fallback={chat.name || 'Group'}
              src={chat.avatar_url}
              className="border-4 border-background shadow-xl ring-1 ring-border/50 bg-secondary"
            />
            {canEdit && (
              <span className="sr-only">Change group photo</span>
            )}
            {canEdit && (
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onAvatarChange(f);
                  e.target.value = '';
                }}
              />
            )}
          </label>
        </div>
      </div>

      <div className="px-5 pt-14 pb-6 space-y-6">
        {canEdit ? (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground ml-1">Group name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-secondary/30 border-border/50 rounded-xl" />
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">{chat.name || 'Group'}</h1>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users size={16} className="text-primary/70 shrink-0" />
          <span>
            {memberCount} member{memberCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
          {canEdit ? (
            <textarea
              className="w-full min-h-[100px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 resize-y"
              placeholder="Group bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          ) : (
            <p className="text-sm text-foreground/90 leading-relaxed">{chat.bio?.trim() ? chat.bio : 'No bio yet.'}</p>
          )}
        </div>

        {canEdit && (
          <Button type="button" disabled={saving || !name.trim()} onClick={() => void saveProfile()} className="w-full gap-2">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            Save changes
          </Button>
        )}

        <div className="rounded-xl border border-border/40 bg-secondary/15 p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notifications</p>
          <Button
            type="button"
            variant="outline"
            disabled={muteToggling}
            onClick={() => void toggleMuteNotifications()}
            className="w-full justify-start gap-3 h-auto py-3 border-border/50 bg-secondary/20 hover:bg-secondary/40"
          >
            {muteToggling ? (
              <Loader2 className="animate-spin shrink-0" size={20} />
            ) : notificationsMuted ? (
              <BellOff className="shrink-0 text-muted-foreground" size={20} />
            ) : (
              <Bell className="shrink-0 text-primary" size={20} />
            )}
            <span className="flex flex-col items-start text-left gap-0.5">
              <span className="font-medium text-foreground">
                {notificationsMuted ? 'Muted' : 'Notifications on'}
              </span>
              <span className="text-xs font-normal text-muted-foreground leading-snug">
                {notificationsMuted
                  ? 'Unmute to get desktop alerts for this group.'
                  : 'Mute to stop desktop alerts for this group.'}
              </span>
            </span>
          </Button>
        </div>

        <div className="rounded-xl border border-border/40 bg-secondary/15 p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Membership</p>
          {isGroupOwner ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Owners can&apos;t leave. Transfer ownership or delete the group from the gear menu.
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLeaveOpen(true)}
              className="w-full justify-start gap-3 h-auto py-3 border-border/50 bg-secondary/20 hover:bg-secondary/40 text-foreground"
            >
              <LogOut className="shrink-0 text-muted-foreground" size={20} />
              <span className="flex flex-col items-start text-left gap-0.5">
                <span className="font-medium">Leave group</span>
                <span className="text-xs font-normal text-muted-foreground">Remove this chat from your list</span>
              </span>
            </Button>
          )}
        </div>

        <LeaveGroupModal
          isOpen={leaveOpen}
          onClose={() => setLeaveOpen(false)}
          groupName={chat.name || 'Group'}
          isOwner={isGroupOwner}
          loading={leaveLoading}
          onConfirmLeave={confirmLeave}
        />

        <div className="space-y-3 px-1 pt-2 border-t border-border/30">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Calendar size={16} className="text-primary/70 shrink-0" />
            <span>Group chat</span>
          </div>
        </div>

        <div className="pt-4 border-t border-border/30">
          <h3 className="font-semibold text-sm mb-4 text-foreground tracking-tight">Shared media</h3>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-square bg-secondary/30 rounded-xl flex items-center justify-center border border-border/30"
              >
                <ImageIcon size={20} className="text-muted-foreground/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
