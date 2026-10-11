import { randomUUID } from 'node:crypto';
import { generateImage, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { requireStudent } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

type SlideContent = { title?: string; bullets?: string[]; notes?: string; imagePrompt?: string; imageAlt?: string };
type Citation = { title?: string; url?: string; snippet?: string };
type SavedSlide = { id: string; title: string; bullets: string[]; notes: string; image_alt: string; image_path: string | null; image_mime_type?: string };

function cleanDeckJson(text: string) {
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(json) as { title: string; slides: { title: string; bullets: string[]; notes?: string; imagePrompt?: string; imageAlt?: string }[] };
}

function safeProviderDetail(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return [process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.GROQ_API_KEY]
    .filter((key): key is string => Boolean(key))
    .reduce((message, key) => message.split(key).join('[redacted]'), raw)
    .replace(/\s+/g, ' ').slice(0, 140);
}

export async function GET(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view saved presentations.' }, { status: 401 });
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  if (!conversationId) return Response.json({ error: 'Choose a study chat.' }, { status: 400 });
  const { data, error } = await supabase.from('presentation_decks').select('*').eq('conversation_id', conversationId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return Response.json({ error: 'Could not load the saved presentation.' }, { status: 500 });
  if (!data) return Response.json({ deck: null });
  const slides = await Promise.all((data.slides as SavedSlide[]).map(async (slide) => {
    if (!slide.image_path) return slide;
    const { data: signed } = await supabase.storage.from('student-files').createSignedUrl(slide.image_path, 3600);
    return { ...slide, image_url: signed?.signedUrl || null };
  }));
  const savedTheme = data.theme as { backgroundColor?: string; headingColor?: string; bodyColor?: string; fontColor?: string; includeImages?: boolean };
  const theme = { backgroundColor: savedTheme.backgroundColor || '#111827', headingColor: savedTheme.headingColor || savedTheme.fontColor || '#f9fafb', bodyColor: savedTheme.bodyColor || savedTheme.fontColor || '#e5e7eb', includeImages: Boolean(savedTheme.includeImages) };
  return Response.json({ deck: { ...data, slides, theme } });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in before creating a presentation.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { conversationId?: string; prompt?: string; includeImages?: boolean; theme?: { backgroundColor?: string; headingColor?: string; bodyColor?: string; fontColor?: string } } | null;
  const conversationId = String(body?.conversationId || '');
  const prompt = String(body?.prompt || '').trim().slice(0, 12000);
  const includeImages = body?.includeImages === true;
  const requestedBackground = body?.theme?.backgroundColor || '';
  const requestedHeading = body?.theme?.headingColor || body?.theme?.fontColor || '';
  const requestedBody = body?.theme?.bodyColor || body?.theme?.fontColor || '';
  const theme = { backgroundColor: /^#[0-9a-f]{6}$/i.test(requestedBackground) ? requestedBackground : '#111827', headingColor: /^#[0-9a-f]{6}$/i.test(requestedHeading) ? requestedHeading : '#f9fafb', bodyColor: /^#[0-9a-f]{6}$/i.test(requestedBody) ? requestedBody : '#e5e7eb', includeImages };
  if (!conversationId || !prompt) return Response.json({ error: 'Add a topic and select a study chat.' }, { status: 400 });
  const { data: conversation } = await supabase.from('conversations').select('id').eq('id', conversationId).single();
  if (!conversation) return Response.json({ error: 'Study chat not found.' }, { status: 404 });
  const { data: history } = await supabase.from('messages').select('role,content,citations').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(80);
  const context = (history || []).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n').slice(-26000);
  await supabase.from('messages').insert({ conversation_id: conversationId, user_id: user.id, client_id: `presentation-${randomUUID()}`, role: 'user', content: prompt, citations: [], task_mode: 'slides' });
  const { data: materials } = await supabase.from('materials').select('name,extracted_text').eq('conversation_id', conversationId).eq('user_id', user.id).eq('status', 'ready');
  const courseNotes = (materials || []).map((m) => `${m.name}: ${m.extracted_text}`).join('\n').slice(0, 18000);
  const sys = 'Create an academically useful, presentation-ready slide deck. Return only JSON: {"title":string,"slides":[{"title":string,"bullets":string[],"notes":string,"imagePrompt":string,"imageAlt":string}]}. Make 5-10 slides, concise, logically sequenced, and grounded in supplied chat/course notes. Use a title slide and conclusion. Do not invent citations.';
  let generated: { title: string; slides: { title: string; bullets: string[]; notes?: string; imagePrompt?: string; imageAlt?: string }[] } | null = null;
  const errors: string[] = [];
  for (const model of [google('gemini-3.8-flash'), groq('openai/gpt-oss-20b')]) {
    try {
      const result = await generateText({ model, system: sys, prompt: `Conversation context:\n${context}\n\nCourse materials:\n${courseNotes}\n\nCreate a presentation about: ${prompt}`, maxOutputTokens: 6000 });
      generated = cleanDeckJson(result.text);
      if (!generated.title || !Array.isArray(generated.slides) || !generated.slides.length) throw new Error('The provider returned an incomplete slide deck.');
      break;
    } catch (error) { errors.push(safeProviderDetail(error)); }
  }
  if (!generated) return Response.json({ error: `Could not create the slide deck. Check that an AI provider is configured and try again. ${errors.join(' · ')}` }, { status: 502 });

  const citations = (history || []).flatMap((m) => Array.isArray(m.citations) ? m.citations as Citation[] : []).filter((source) => source.url).slice(0, 30);
  const id = randomUUID();
  let imageWarning: string | null = null;
  const imageErrors: string[] = [];
  const slides = await Promise.all(generated.slides.slice(0, 16).map(async (slide: SlideContent, index) => {
    const normalized = { id: randomUUID(), title: String(slide.title || `Slide ${index + 1}`).slice(0, 180), bullets: Array.isArray(slide.bullets) ? slide.bullets.map((item) => String(item).slice(0, 600)).slice(0, 8) : [], notes: String(slide.notes || '').slice(0, 2000), image_alt: String(slide.imageAlt || slide.title || ''), image_path: null as string | null };
    if (includeImages && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      try {
        const imagePrompt = String(slide.imagePrompt || `${slide.title}. ${slide.bullets?.join('. ') || ''}`).slice(0, 1000);
        const image = await generateImage({ model: google.image('gemini-3.1-flash-image-preview'), prompt: `Create a clear, high-quality academic presentation illustration for: ${imagePrompt}. Landscape 16:9. Make a visual that supports the topic. No text, labels, watermark, or logo.`, aspectRatio: '16:9', maxRetries: 0 });
        const mimeType = image.image.mediaType || 'image/png';
        const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
        const path = `${user.id}/${conversationId}/presentations/${id}/slide-${index + 1}.${extension}`;
        const { error } = await supabase.storage.from('student-files').upload(path, image.image.uint8Array, { contentType: mimeType, upsert: true });
        if (error) throw error;
        normalized.image_path = path;
        (normalized as SavedSlide).image_mime_type = mimeType;
      } catch (error) {
        const detail = safeProviderDetail(error);
        imageErrors.push(detail);
      }
    } else if (includeImages) imageWarning = 'AI images are unavailable because Gemini is not configured. The deck was created without images.';
    return normalized;
  }));
  if (includeImages && imageErrors.length) {
    const quotaIssue = imageErrors.some((detail) => /quota|rate limit|billing|free.?tier/i.test(detail));
    imageWarning = quotaIssue
      ? 'Gemini image generation is enabled, but this API key has no available image quota. Add billing or enable image generation for Gemini in Google AI Studio, then create the deck again.'
      : `Gemini could not generate the requested images. ${imageErrors[0] || 'Check the image model configuration and try again.'}`;
  }
  const { data: deck, error } = await supabase.from('presentation_decks').insert({ id, user_id: user.id, conversation_id: conversationId, title: generated.title.slice(0, 180), slides, theme, citations, image_warning: imageWarning }).select('*').single();
  if (error) return Response.json({ error: 'The presentation draft could not be saved. Apply the latest database migration and try again.' }, { status: 500 });
  const withUrls = await Promise.all(slides.map(async (slide) => {
    if (!slide.image_path) return slide;
    const { data: signed } = await supabase.storage.from('student-files').createSignedUrl(slide.image_path, 3600);
    return { ...slide, image_url: signed?.signedUrl || null };
  }));
  return Response.json({ deck: { ...deck, slides: withUrls }, warning: imageWarning }, { status: 201 });
}
