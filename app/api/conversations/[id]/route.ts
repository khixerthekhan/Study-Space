import { requireStudent } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view this study chat.' }, { status: 401 });
  const { id } = await params;
  const { data: conversation, error: conversationError } = await supabase.from('conversations').select('id,title,task_mode').eq('id', id).single();
  if (conversationError || !conversation) return Response.json({ error: 'Study chat not found.' }, { status: 404 });
  const [{ data: messages, error: messagesError }, { data: materials }] = await Promise.all([
    supabase.from('messages').select('client_id,role,content,citations,created_at').eq('conversation_id', id).order('created_at'),
    supabase.from('materials').select('id,name,mime_type,size_bytes,status,extraction_error,created_at').eq('conversation_id', id).order('created_at'),
  ]);
  if (messagesError) return Response.json({ error: messagesError.message }, { status: 500 });
  return Response.json({ conversation, messages, materials });
}
