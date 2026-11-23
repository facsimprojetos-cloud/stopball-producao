// Estado compartilhado (cliente do Supabase e usuário logado).
// Fica num módulo próprio, sem "?v=", para que todas as telas usem a mesma instância.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, SCHEMA } from './config.js';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: SCHEMA },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export const ctx = { usuario: null, perfis: [], nome: '', email: '', provedor: 'email' };

export function tem(perfil) {
  return ctx.perfis.includes('admin') || ctx.perfis.includes(perfil);
}
