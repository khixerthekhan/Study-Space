import { requireStudent } from '@/lib/supabase/server';

export async function GET() {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view your profile.' }, { status: 401 });
  const { data, error } = await supabase.from('profiles').select('id,display_name,age').eq('id', user.id).single();
  if (error) return Response.json({ error: 'Could not load your student profile. Apply the profile migration and retry.' }, { status: 500 });
  return Response.json({ profile: data });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to complete your profile.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: string; age?: number } | null;
  const name = String(body?.name || '').trim().slice(0, 80);
  const age = Number(body?.age);
  if (name.length < 2) return Response.json({ error: 'Enter a name with at least two characters.' }, { status: 400 });
  if (!Number.isInteger(age) || age < 13 || age > 120) return Response.json({ error: 'Enter an age from 13 to 120.' }, { status: 400 });
  const { data, error } = await supabase.from('profiles').upsert({ id: user.id, display_name: name, age }).select('id,display_name,age').single();
  if (error) return Response.json({ error: 'Your profile could not be saved. Apply the profile migration and try again.' }, { status: 500 });
  return Response.json({ profile: data });
}
