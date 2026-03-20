import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ImagePlus, Loader2, Search, Users } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { notifyUserChatListRefresh } from '../../lib/notifyChatListRefresh';

interface FriendRow {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  friends: FriendRow[];
  onCreated: (chatId: string) => void;
}

export function CreateGroupModal({ isOpen, onClose, friends, onCreated }: CreateGroupModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<0 | 1>(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(0);
      setSearch('');
      setSelected(new Set());
      setGroupName('');
      setBio('');
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q),
    );
  }, [friends, search]);

  const toggleFriend = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onPickAvatar = (file: File | null) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleCreate = async () => {
    if (!user || !groupName.trim() || selected.size < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      const memberIds = Array.from(selected);
      const { data: chatId, error: rpcError } = await supabase.rpc('create_group_chat', {
        p_name: groupName.trim(),
        p_bio: bio.trim(),
        p_member_ids: memberIds,
      });

      if (rpcError) throw rpcError;
      const id = typeof chatId === 'string' ? chatId : null;
      if (!id) throw new Error('No chat id returned');

      if (avatarFile) {
        const ext = (avatarFile.name.split('.').pop() || 'png').toLowerCase();
        const path = `groups/${id}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('chatimages').upload(path, avatarFile, {
          upsert: true,
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('chatimages').getPublicUrl(path);
        if (pub?.publicUrl) {
          await supabase.from('chats').update({ avatar_url: pub.publicUrl }).eq('id', id);
        }
      }

      await Promise.all(memberIds.map((mid) => notifyUserChatListRefresh(mid)));

      onCreated(id);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not create group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" className="max-w-xl">
      <div className="relative min-h-[420px] overflow-hidden">
        <div className="flex items-center gap-2 mb-6 text-muted-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users size={18} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-primary/80">New group</p>
            <p className="text-sm text-foreground font-semibold">
              {step === 0 ? 'Choose members' : 'Name & appearance'}
            </p>
          </div>
          <div className="ml-auto flex gap-1">
            {[0, 1].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-6 rounded-full transition-colors',
                  step === i ? 'bg-primary' : 'bg-secondary',
                )}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {step === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="space-y-4"
            >
              <div className="relative">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="Search friends..."
                  className="pl-12 box-border h-12 bg-secondary/30 border-border/50 text-base rounded-xl focus-visible:ring-primary/50"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {filteredFriends.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No friends match your search.</p>
                ) : (
                  filteredFriends.map((f) => {
                    const on = selected.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleFriend(f.id)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                          on
                            ? 'border-primary/50 bg-primary/10'
                            : 'border-border/40 bg-secondary/10 hover:bg-secondary/30',
                        )}
                      >
                        <Avatar fallback={f.name} src={f.avatarUrl ?? undefined} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{f.name}</p>
                          <p className="text-xs text-primary/80 truncate">@{f.username}</p>
                        </div>
                        <div
                          className={cn(
                            'h-8 w-8 rounded-full border-2 flex items-center justify-center shrink-0',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-border/50',
                          )}
                        >
                          {on && <Check size={16} strokeWidth={3} />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" disabled={selected.size < 1} onClick={() => setStep(1)}>
                  Next
                </Button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="space-y-4"
            >
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="relative shrink-0">
                  <div className="h-24 w-24 rounded-2xl border border-border/50 overflow-hidden bg-secondary/40 flex items-center justify-center">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Users className="text-muted-foreground/40" size={36} />
                    )}
                  </div>
                  <label className="mt-2 flex items-center justify-center gap-2 text-xs text-primary cursor-pointer hover:underline">
                    <ImagePlus size={14} />
                    <span>Optional photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div className="flex-1 space-y-3 w-full">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground ml-1">Group name</label>
                    <Input
                      className="mt-1 h-11 bg-secondary/30 border-border/50 rounded-xl"
                      placeholder="e.g. Weekend crew"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground ml-1">Bio (optional)</label>
                    <textarea
                      className="mt-1 w-full min-h-[88px] rounded-xl bg-secondary/30 border border-border/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      placeholder="What is this group about?"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>
              )}
              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!groupName.trim() || submitting}
                    onClick={() => void handleCreate()}
                    className="gap-2 min-w-[120px]"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : 'Create group'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
