import { requireStudent } from '@/lib/supabase/server';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to save this presentation.' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { title?: string; slides?: { id?: string; title?: string; bullets?: unknown[]; notes?: string; image_alt?: string; image_path?: string | null; image_mime_type?: string }[]; theme?: { backgroundColor?: string; headingColor?: string; bodyColor?: string; includeImages?: boolean } } | null;
  if (!body || typeof body.title !== 'string' || !Array.isArray(body.slides)) return Response.json({ error: 'The presentation changes could not be read.' }, { status: 400 });
  const theme = body.theme || {};
  if (!/^#[0-9a-f]{6}$/i.test(theme.backgroundColor || '') || !/^#[0-9a-f]{6}$/i.test(theme.headingColor || '') || !/^#[0-9a-f]{6}$/i.test(theme.bodyColor || '')) return Response.json({ error: 'Choose valid background, heading, and other text colors.' }, { status: 400 });
  const { data, error } = await supabase.from('presentation_decks').update({ title: body.title.slice(0, 180), slides: body.slides.map((s) => ({ id: String(s.id), title: String(s.title).slice(0, 180), bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 600)).slice(0, 8) : [], notes: String(s.notes || '').slice(0, 2000), image_alt: String(s.image_alt || ''), image_path: typeof s.image_path === 'string' ? s.image_path : null, image_mime_type: typeof s.image_mime_type === 'string' ? s.image_mime_type : 'image/png' })), theme: { backgroundColor: theme.backgroundColor, headingColor: theme.headingColor, bodyColor: theme.bodyColor, includeImages: Boolean(theme.includeImages) } }).eq('id', id).select('id,updated_at').single();
  if (error || !data) return Response.json({ error: 'Could not save this presentation. Please try again.' }, { status: 500 });
  return Response.json({ saved: true, updated_at: data.updated_at });
}
