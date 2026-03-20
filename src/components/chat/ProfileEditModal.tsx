import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/modal';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileEditModal({ isOpen, onClose }: ProfileEditModalProps) {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && isOpen) {
      setName(profile.display_name || '');
      setUsername(profile.username || '');
      setBio(profile.bio || '');
      setAvatarPreview(profile.avatar_url);
      setBannerPreview(profile.banner_url);
      setAvatarFile(null);
      setBannerFile(null);
    }
  }, [profile, isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (type === 'avatar') {
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
      } else {
        setBannerFile(file);
        setBannerPreview(URL.createObjectURL(file));
      }
    }
  };

  const uploadImage = async (file: File, folder: 'avatars' | 'banners') => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${user?.id}-${Math.random()}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      // User named their bucket simply "bucket"
      .from('bucket')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('bucket').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      let finalAvatarUrl = profile?.avatar_url;
      let finalBannerUrl = profile?.banner_url;

      if (avatarFile) {
        finalAvatarUrl = await uploadImage(avatarFile, 'avatars');
      }
      if (bannerFile) {
        finalBannerUrl = await uploadImage(bannerFile, 'banners');
      }

      const safeUsername = username.toLowerCase().replace(/\s/g, '');

      // Check username uniqueness if changed
      if (safeUsername !== profile?.username) {
        const { data: existing } = await supabase.from('users').select('id').eq('username', safeUsername).maybeSingle();
        if (existing) {
          throw new Error('Username is already taken.');
        }
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({
          display_name: name,
          username: safeUsername,
          bio,
          avatar_url: finalAvatarUrl,
          banner_url: finalBannerUrl,
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      await refreshProfile();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit profile"
      description="Update how you appear to friends and in groups."
    >
      <form onSubmit={handleSave} className="space-y-6">
        {error && (
          <div className="bg-red-500/10 text-red-500 text-sm p-3 rounded-md border border-red-500/20">
            {error}
          </div>
        )}
        
        {/* Banner Edit */}
        <div className="relative h-32 w-full bg-secondary/50 rounded-xl overflow-hidden group border border-border/30">
           {bannerPreview ? (
             <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
           ) : (
             <div className="w-full h-full bg-gradient-to-tr from-primary/20 to-accent/20" />
           )}
          <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'banner')} />
            <Camera className="text-white" size={24} />
          </label>
        </div>

        {/* Avatar Edit */}
        <div className="flex justify-center -mt-12 relative z-10">
          <div className="relative group inline-block">
            <div className="h-20 w-20 rounded-full bg-secondary border-4 border-background shadow-lg overflow-hidden flex items-center justify-center relative">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-bold text-muted-foreground">{profile?.display_name?.slice(0, 2).toUpperCase() || 'MY'}</span>
              )}
            </div>
            <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-4 border-background">
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'avatar')} />
              <Camera className="text-white" size={20} />
            </label>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground ml-1">Display Name</label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              className="bg-secondary/20"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground ml-1">Username</label>
            <Input 
              value={username} 
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} 
              className="bg-secondary/20"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground ml-1">Bio</label>
            <textarea 
              value={bio} 
              onChange={(e) => setBio(e.target.value)} 
              className="flex w-full rounded-md border border-border bg-secondary/20 backdrop-blur-sm px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:bg-background disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 min-h-[80px] resize-none"
              placeholder="Tell us about yourself"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border/30">
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" className="shadow-lg shadow-primary/20 bg-primary w-32 justify-center" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={18} /> : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
