import pptxgen from 'pptxgenjs';
import { requireStudent } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

type ExportSlide = { title: string; bullets?: string[]; notes?: string; image_path?: string | null; image_mime_type?: string };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to export this presentation.' }, { status: 401 });
  const { id } = await params;
  const { data: deck, error } = await supabase.from('presentation_decks').select('*').eq('id', id).single();
  if (error || !deck) return Response.json({ error: 'Presentation not found.' }, { status: 404 });
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'StudySpace AI'; pptx.subject = 'Academic presentation'; pptx.title = deck.title;
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
  const theme = deck.theme as { backgroundColor?: string; headingColor?: string; bodyColor?: string; fontColor?: string };
  const bg = (theme.backgroundColor || '#111827').replace('#', '').toUpperCase();
  const headingColor = (theme.headingColor || theme.fontColor || '#F9FAFB').replace('#', '').toUpperCase();
  const bodyColor = (theme.bodyColor || theme.fontColor || '#E5E7EB').replace('#', '').toUpperCase();
  for (const item of deck.slides as ExportSlide[]) {
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    slide.addText(item.title, { x: 0.65, y: 0.45, w: 12, h: 0.8, fontFace: 'Aptos Display', fontSize: 28, bold: true, color: headingColor, breakLine: false, margin: 0.02 });
    let y = 1.55;
    for (const bullet of (item.bullets || []).slice(0, 8)) {
      slide.addText(bullet, { x: 0.9, y, w: item.image_path ? 7.0 : 11.4, h: 0.65, fontFace: 'Aptos', fontSize: 19, color: bodyColor, bullet: { indent: 18 }, paraSpaceAfter: 12, breakLine: false, valign: 'middle', margin: 0.03, fit: 'shrink' });
      y += 0.77;
    }
    if (item.image_path) {
      const { data: image } = await supabase.storage.from('student-files').download(item.image_path);
      if (image) slide.addImage({ data: `data:${item.image_mime_type || 'image/png'};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`, sizing: { type: 'contain', x: 8.1, y: 1.55, w: 4.5, h: 4.3 } });
    }
    if (item.notes) slide.addNotes(item.notes);
  }
  const citations = Array.isArray(deck.citations) ? deck.citations as { title?: string; url?: string }[] : [];
  if (citations.length) {
    const slide = pptx.addSlide(); slide.background = { color: bg };
    slide.addText('Sources', { x: 0.65, y: 0.45, w: 12, h: 0.8, fontSize: 28, bold: true, color: headingColor });
    slide.addText(citations.slice(0, 16).map((source) => `${source.title || 'Source'}\n${source.url || ''}`).join('\n\n'), { x: 0.85, y: 1.45, w: 11.6, h: 5.2, fontSize: 13, color: bodyColor, breakLine: false, valign: 'top', margin: 0.05, fit: 'shrink' });
  }
  try {
    const bytes = await pptx.write({ outputType: 'uint8array' }) as Uint8Array;
    const storagePath = `${user.id}/${deck.conversation_id}/${deck.id}.pptx`;
    const { error: uploadError } = await supabase.storage.from('student-files').upload(storagePath, bytes, { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', upsert: true });
    if (uploadError) return Response.json({ error: `The deck was prepared but could not be saved: ${uploadError.message}` }, { status: 500 });
    const { data: artifact, error: recordError } = await supabase.from('artifacts').insert({ user_id: user.id, conversation_id: deck.conversation_id, title: deck.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'presentation', format: 'pptx', storage_path: storagePath }).select('id,title,format,created_at').single();
    if (recordError) return Response.json({ error: 'The PowerPoint was created but its private file record could not be saved. Apply the latest database migration.' }, { status: 500 });
    return Response.json({ artifact });
  } catch { return Response.json({ error: 'PowerPoint export failed. Try reducing slide count or removing large images.' }, { status: 500 }); }
}
