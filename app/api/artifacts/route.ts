/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { createStudyDocument } from '@/lib/export-document';
import { requireStudent } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

function fileSafeTitle(value: string) {
  return value.replace(/^\s*#+\s*/, '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '').replace(/[.?!]+$/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 9).join(' ').slice(0, 72).trim() || 'Study notes';
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return [process.env.GROQ_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY]
    .filter((key): key is string => Boolean(key))
    .reduce((message, key) => message.split(key).join('[redacted]'), raw)
    .replace(/\s+/g, ' ').slice(0, 300);
}

export async function GET(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to view saved files.' }, { status: 401 });
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  if (!conversationId) return Response.json({ error: 'A conversation ID is required.' }, { status: 400 });
  const { data, error } = await supabase.from('artifacts').select('id,title,format,created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ artifacts: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to create a saved file.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversationId || '');
  const format = ['pdf', 'docx', 'both'].includes(body?.format) ? body.format as 'pdf' | 'docx' | 'both' : null;
  const consentText = String(body?.consentText || '').trim().slice(0, 1000);
  const affirmative = /^(yes|yeah|yep|sure|please|make|create|generate|export|both|word|pdf|\.docx)|\b(create|make|generate|export|download|save|prepare)\b/i.test(consentText);
  const matchesFormat = format === 'both' ? /\bboth\b/i.test(consentText) : format === 'pdf' ? /\b(pdf|both)\b/i.test(consentText) : /\b(word|docx|both)\b/i.test(consentText);
  if (!conversationId || !format || !affirmative || !matchesFormat) return Response.json({ error: 'A clear request and chosen file format are required before creating a document.' }, { status: 400 });

  const { data: offerMessages } = await supabase.from('messages').select('content,task_mode').eq('conversation_id', conversationId).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1);
  const assistantOffered = Boolean(offerMessages?.[0]?.content.includes('Would you like me to create a Word file, a PDF, or both from the key points across our conversation?'));
  const explicitDirectRequest = /\b(create|make|generate|export|download|prepare)\b/i.test(consentText) && /\b(word|docx|pdf|both)\b/i.test(consentText);
  if (!assistantOffered && !explicitDirectRequest) {
    return Response.json({ error: 'The assistant has not offered to create a document for this chat yet.' }, { status: 409 });
  }
  const consentId = randomUUID();
  const { error: consentError } = await supabase.from('messages').insert({
    conversation_id: conversationId, user_id: user.id, client_id: `consent-${consentId}`,
    role: 'user', content: consentText, citations: [], task_mode: offerMessages?.[0]?.task_mode || 'general',
  });
  if (consentError) return Response.json({ error: 'Your confirmation could not be saved.' }, { status: 500 });

  const [{ data: conversation }, { data: messages, error: messageError }, { data: materials }] = await Promise.all([
    supabase.from('conversations').select('id,title,task_mode').eq('id', conversationId).single(),
    supabase.from('messages').select('role,content,citations,created_at').eq('conversation_id', conversationId).neq('client_id', `consent-${consentId}`).order('created_at'),
    supabase.from('materials').select('name,extracted_text').eq('conversation_id', conversationId).not('extracted_text', 'eq', ''),
  ]);
  if (!conversation) return Response.json({ error: 'Study chat not found.' }, { status: 404 });
  if (messageError || !messages?.length) return Response.json({ error: 'There is no conversation content to include yet.' }, { status: 400 });

  const transcript = [
    messages.map((message) => `${message.role === 'user' ? 'Student' : 'Assistant'}: ${message.content}`).join('\n\n'),
    ...(materials || []).map((material) => `Uploaded study material — ${material.name}:\n${material.extracted_text}`),
  ].join('\n\n').slice(0, 60_000);
  const citations = messages.flatMap((message) => Array.isArray(message.citations) ? message.citations : [])
    .filter((source: any, index: number, all: any[]) => source?.url && all.findIndex((candidate) => candidate.url === source.url) === index)
    .map((source: any) => ({ title: String(source.title || source.url), url: String(source.url) }));

  let markdown = '';
  const providers = [
    ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY ? [{ name: 'Gemini', model: google('gemini-3.8-flash') }] : []),
    ...(process.env.GROQ_API_KEY ? [{ name: 'Groq', model: groq('openai/gpt-oss-20b') }] : []),
  ];
  const prompt = `Study focus: ${conversation.task_mode}\nConversation title: ${conversation.title}\n\nFull conversation context:\n${transcript.slice(0, 60_000)}\n\nSource references available:\n${citations.map((source, index) => `[${index + 1}] ${source.title} — ${source.url}`).join('\n') || 'No web sources were attached.'}`;
  const system = 'Create a polished academic study document by synthesizing the relevant answers, key points, topics, decisions, and useful explanations across the whole conversation. Do not copy the raw transcript, repeat the student’s questions, include an FAQ, or mention the document creation date. Start with exactly one concise Markdown H1 heading of 3–9 words that names the central topic and works as a short filename (for example, # Medical Uses of Venom). After that heading, begin directly with the substantive answer. Use meaningful headings, short paragraphs, and separate bullets. For schedules, use a heading for each week with each activity on its own bullet. Include a sources section only for the supplied source references; never invent citations. Ignore confirmation messages and prior assistant offers to create a file.';
  const providerErrors: string[] = [];
  for (const provider of providers) {
    try {
      const result = await generateText({ model: provider.model, system, prompt, maxOutputTokens: 7000, abortSignal: request.signal });
      markdown = result.text.trim();
      if (markdown) break;
    } catch (error) {
      const detail = safeError(error);
      console.error(`Study document provider ${provider.name} failed: ${detail}`);
      providerErrors.push(`${provider.name}: ${detail}`);
    }
  }
  if (!markdown) return Response.json({ error: providers.length ? `The document could not be prepared. ${providerErrors.join(' | ') || 'The AI provider returned an empty response.'}` : 'No AI provider key is configured. Add GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY to .env.local, then restart the development server.' }, { status: 502 });
  if (!markdown) return Response.json({ error: 'The document generator returned an empty document.' }, { status: 502 });

  const headingMatch = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  const title = fileSafeTitle(headingMatch?.[1] || conversation.title || 'Study notes');
  if (headingMatch) markdown = markdown.replace(headingMatch[0], '').trimStart();
  const formats: ('docx' | 'pdf')[] = format === 'both' ? ['docx', 'pdf'] : [format];
  const generated: { format: 'docx' | 'pdf'; bytes: Uint8Array; storagePath: string; id: string }[] = [];
  try {
    for (const outputFormat of formats) {
      const bytes = await createStudyDocument(outputFormat, title, markdown, citations);
      generated.push({ format: outputFormat, bytes, storagePath: `${user.id}/${conversationId}/${randomUUID()}.${outputFormat}`, id: randomUUID() });
    }
  } catch (error) {
    return Response.json({ error: `Document formatting failed: ${safeError(error) || 'unknown formatting error'}` }, { status: 500 });
  }
  const storedPaths: string[] = [];
  const records = [];
  for (const item of generated) {
    const mimeType = item.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const { error: storageError } = await supabase.storage.from('student-files').upload(item.storagePath, item.bytes, { contentType: mimeType, upsert: false });
    if (storageError) {
      await supabase.storage.from('student-files').remove(storedPaths);
      return Response.json({ error: `The file could not be saved to private storage: ${storageError.message}` }, { status: 500 });
    }
    storedPaths.push(item.storagePath);
    records.push({ id: item.id, user_id: user.id, conversation_id: conversationId, title, format: item.format, storage_path: item.storagePath });
  }
  const { data: artifacts, error: recordError } = await supabase.from('artifacts').insert(records).select('id,title,format,created_at');
  if (recordError || !artifacts) {
    await supabase.storage.from('student-files').remove(storedPaths);
    return Response.json({ error: `The files were created but could not be added to your saved records: ${recordError?.message || 'database error'}` }, { status: 500 });
  }
  const confirmation = `Created ${artifacts.map((artifact) => artifact.format.toUpperCase()).join(' and ')} from the key points in this conversation.`;
  const confirmationId = `artifact-${randomUUID()}`;
  await supabase.from('messages').insert({ conversation_id: conversationId, user_id: user.id, client_id: confirmationId, role: 'assistant', content: confirmation, citations: [], task_mode: conversation.task_mode });
  return Response.json({ artifacts, consent: { id: `consent-${consentId}`, content: consentText }, confirmation: { id: confirmationId, content: confirmation } }, { status: 201 });
}
