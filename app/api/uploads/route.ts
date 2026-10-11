import { randomUUID } from 'node:crypto';
import { ALLOWED_TYPES, extractDocumentText, extractPdfWithOcr, MAX_UPLOAD_BYTES } from '@/lib/documents';
import { requireStudent } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function GET() {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view saved study materials.' }, { status: 401 });
  const { data, error } = await supabase.from('materials').select('id,name,mime_type,size_bytes,status,extraction_error,created_at').eq('user_id', user.id).is('conversation_id', null).order('created_at', { ascending: false });
  if (error) return Response.json({ error: 'Could not load saved study materials.' }, { status: 500 });
  return Response.json({ materials: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in before uploading study materials.' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'The upload could not be read. Try selecting the file again.' }, { status: 400 });
  }
  const file = formData.get('file');
  const conversationId = String(formData.get('conversationId') || '');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (!ALLOWED_TYPES[file.type]) return Response.json({ error: 'Supported formats are PNG/JPG, TXT, PDF, and DOCX.' }, { status: 415 });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'Files must be between 1 byte and 10 MB.' }, { status: 413 });

  if (conversationId) {
    const { data: conversation } = await supabase.from('conversations').select('id').eq('id', conversationId).single();
    if (!conversation) return Response.json({ error: 'Study chat not found.' }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksValid = file.type === 'image/png' ? bytes.length > 8 && [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)
    : file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : file.type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
    : file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? bytes[0] === 80 && bytes[1] === 75
    : file.type === 'text/plain' ? !bytes.slice(0, 4096).includes(0)
    : false;
  if (!looksValid) return Response.json({ error: 'The file contents do not match the selected file type.' }, { status: 415 });
  let extractedText = '';
  let extractionError: string | null = null;
  try {
    if (file.type === 'application/pdf') {
      const result = await extractPdfWithOcr(bytes);
      extractedText = result.text;
      extractionError = result.error || null;
    } else extractedText = await extractDocumentText(file, bytes);
  } catch {
    if (file.type !== 'application/pdf') return Response.json({ error: 'This file could not be read. Try exporting it again as a standard PDF or DOCX.' }, { status: 422 });
    extractionError = 'The PDF was saved, but its contents could not be extracted. Try a non-corrupted PDF or upload clear page images.';
  }
  if (file.type !== 'application/pdf' && file.type !== 'image/png' && file.type !== 'image/jpeg' && !extractedText.trim()) return Response.json({ error: 'No readable text was found in this file. Try a standard TXT, PDF, or DOCX file.' }, { status: 422 });

  const extension = ALLOWED_TYPES[file.type];
  const storagePath = `${user.id}/${conversationId || 'materials'}/${randomUUID()}.${extension}`;
  const { error: storageError } = await supabase.storage.from('student-files').upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (storageError) return Response.json({ error: `Upload failed: ${storageError.message}` }, { status: 500 });

  const { data: material, error: recordError } = await supabase.from('materials').insert({
    user_id: user.id,
    conversation_id: conversationId || null,
    name: file.name.slice(0, 240),
    mime_type: file.type,
    size_bytes: file.size,
    storage_path: storagePath,
    extracted_text: extractedText,
    status: extractedText.trim() || file.type === 'image/png' || file.type === 'image/jpeg' ? 'ready' : 'failed',
    extraction_error: extractionError,
  }).select('id,name,mime_type,size_bytes,created_at,status,extraction_error').single();

  if (recordError) {
    await supabase.storage.from('student-files').remove([storagePath]);
    return Response.json({ error: 'File stored but its study record could not be saved.' }, { status: 500 });
  }
  return Response.json({ material, warning: extractionError }, { status: 201 });
}
