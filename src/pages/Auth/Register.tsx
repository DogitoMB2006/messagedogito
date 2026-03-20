import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, Mail, Lock, AtSign } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { supabase } from '../../lib/supabase';
import type { AuthError } from '@supabase/supabase-js';

function formatSignUpError(err: AuthError): string {
  const msg = (err.message || '').trim();
  const combined = `${msg} ${(err as { code?: string }).code || ''}`.toLowerCase();
  // GoTrue returns this for duplicate email — users often think it means "username".
  if (
    combined.includes('user already registered') ||
    combined.includes('already been registered') ||
    combined.includes('already registered') ||
    combined.includes('email address is already') ||
    combined.includes('user_already_exists')
  ) {
    return 'This email is already registered. Try signing in instead.';
  }
  return msg || 'Could not create account. Check your email and password.';
}

export function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const safeUsername = username.toLowerCase().replace(/\s/g, '');

    if (!safeUsername) {
      setError('Please choose a username.');
      setLoading(false);
      return;
    }

    // Only trust this when the query succeeds — RLS/permission errors must not look like "taken".
    const { data: takenRow, error: usernameLookupError } = await supabase
      .from('users')
      .select('id')
      .eq('username', safeUsername)
      .maybeSingle();

    if (usernameLookupError) {
      console.warn('Register: username check skipped', usernameLookupError.message);
    } else if (takenRow) {
      setError('Username is already taken.');
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          username: safeUsername,
          display_name: safeUsername,
        },
      },
    });

    if (signUpError) {
      setError(formatSignUpError(signUpError));
      setLoading(false);
      return;
    }

    if (!data.user) {
      setError('Sign up did not complete. Please try again.');
      setLoading(false);
      return;
    }

    // With "confirm email" enabled there is often no session yet — RLS may block this insert.
    const { error: profileError } = await supabase.from('users').insert({
      id: data.user.id,
      username: safeUsername,
      display_name: safeUsername,
    });

    if (profileError) {
      const code = (profileError as { code?: string }).code;
      const pmsg = profileError.message || '';
      if (code === '23505' || /unique|duplicate/i.test(pmsg)) {
        setError('That username is already taken. Pick another and try again.');
        setLoading(false);
        return;
      }
      if (code === '42501' || /row-level security|policy|permission denied/i.test(pmsg)) {
        setError(
          'Account created. If email confirmation is on, open the link in your email, then sign in. Your profile will finish setting up when you log in.',
        );
        setLoading(false);
        navigate('/login');
        return;
      }
      setError(pmsg || 'Could not create your profile.');
      setLoading(false);
      return;
    }

    setLoading(false);
    navigate('/');
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4 overflow-hidden relative">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/20 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md space-y-8 z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent to-primary shadow-lg shadow-accent/20 text-white mb-6">
            <MessageSquare size={32} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Create account</h2>
          <p className="mt-2 text-sm text-muted-foreground">Join the conversation today</p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", bounce: 0.4 }}
          onSubmit={handleRegister}
          className="space-y-6 rounded-2xl border border-border/50 bg-secondary/30 p-8 backdrop-blur-xl shadow-2xl"
        >
          {error && (
            <div className="bg-red-500/10 text-red-500 text-sm p-3 rounded-md mb-4 border border-red-500/20">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="name@example.com"
                  className="pl-10 h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Username</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="unique_username"
                  className="pl-10 h-11"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">Usernames must be unique and lowercase.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full h-11 text-base bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20">
            {loading ? 'Creating...' : 'Create Account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline hover:text-primary/80 transition-colors">Sign in</Link>
          </p>
        </motion.form>
      </div>
    </div>
  );
}
