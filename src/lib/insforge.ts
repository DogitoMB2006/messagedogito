import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY?.trim() ?? '';

export const isInsforgeConfigured = () => Boolean(baseUrl && anonKey);

export const insforge = createClient({
  baseUrl: baseUrl || 'https://placeholder.insforge.app',
  anonKey: anonKey || undefined,
});
