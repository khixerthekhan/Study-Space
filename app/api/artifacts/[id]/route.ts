import { requireStudent } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to download this file.' }, { status: 401 });
  const { id } = await params;
  const { data: artifact, error } = await supabase.from('artifacts').select('title,format,storage_path').eq('id', id).single();
  if (error || !artifact) return Response.json({ error: 'Saved file not found.' }, { status: 404 });
  const { data: file, error: downloadError } = await supabase.storage.from('student-files').download(artifact.storage_path);
  if (downloadError || !file) return Response.json({ error: 'The saved file could not be downloaded.' }, { status: 404 });
  const mimeType = artifact.format === 'pdf' ? 'application/pdf' : artifact.format === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return new Response(await file.arrayBuffer(), { headers: {
    'Content-Type': mimeType,
    'Content-Disposition': `attachment; filename="${artifact.title}.${artifact.format}"`,
    'Cache-Control': 'private, no-store',
  } });
}
