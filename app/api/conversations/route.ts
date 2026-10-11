import { requireStudent } from '@/lib/supabase/server';

export async function GET() {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view your study chats.' }, { status: 401 });
  const { data, error } = await supabase.from('conversations').select('id,title,task_mode,created_at,updated_at').order('updated_at', { ascending: false }).limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ conversations: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to save your study chat.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = String(body?.title || 'New study chat').trim().slice(0, 100) || 'New study chat';
  const taskMode = ['research','journals','assignments','quizzes','slides','career','general'].includes(body?.taskMode) ? body.taskMode : 'research';
  const { data, error } = await supabase.from('conversations').insert({ user_id: user.id, title, task_mode: taskMode }).select('id,title,task_mode,created_at,updated_at').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ conversation: data }, { status: 201 });
}
