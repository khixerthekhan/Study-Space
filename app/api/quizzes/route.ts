/* eslint-disable @typescript-eslint/no-explicit-any */
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { requireStudent } from '@/lib/supabase/server';

export const maxDuration = 90;

function parseQuestions(source: string) {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  const parsed = JSON.parse(source.slice(start, end + 1));
  if (!Array.isArray(parsed)) return null;
  const questions = parsed.slice(0, 12).map((item: any) => ({
    question: String(item.question || '').slice(0, 600),
    options: Array.isArray(item.options) ? item.options.slice(0, 5).map((option: unknown) => String(option).slice(0, 300)) : [],
    correctIndex: Number(item.correctIndex),
    explanation: String(item.explanation || '').slice(0, 1200),
  })).filter((item: any) => item.question && item.options.length >= 2 && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < item.options.length);
  return questions.length ? questions : null;
}

function toClientQuiz(quiz: any) {
  return {
    ...quiz,
    questions: (quiz.questions || []).map((question: any) => { const { correctIndex, ...safeQuestion } = question; void correctIndex; return safeQuestion; }),
  };
}

export async function GET(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to load quiz progress.' }, { status: 401 });
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  if (!conversationId) return Response.json({ quizzes: [] });
  const { data, error } = await supabase.from('quiz_sessions').select('id,conversation_id,title,questions,answers,created_at,updated_at').eq('conversation_id', conversationId).order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ quizzes: (data || []).map(toClientQuiz) });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to start a saved quiz.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversationId || '');
  const { data: conversation } = await supabase.from('conversations').select('id,title,task_mode').eq('id', conversationId).single();
  if (!conversation) return Response.json({ error: 'Study chat not found.' }, { status: 404 });
  const { data: messages } = await supabase.from('messages').select('role,content').eq('conversation_id', conversationId).order('created_at');
  const { data: materials } = await supabase.from('materials').select('name,extracted_text').eq('conversation_id', conversationId).not('extracted_text', 'eq', '');
  const context = [
    ...(messages || []).map((message) => `${message.role}: ${message.content}`),
    ...(materials || []).map((material) => `Course material ${material.name}: ${material.extracted_text}`),
  ].join('\n\n').slice(0, 36_000);
  if (!context.trim()) return Response.json({ error: 'Ask about a topic or attach course material before starting a quiz.' }, { status: 400 });

  const model = process.env.GROQ_API_KEY ? groq('openai/gpt-oss-20b') : google('gemini-3.8-flash');
  let questions;
  try {
    const result = await generateText({
      model,
      system: 'Write a useful academic practice quiz using only the provided study context. Return only a JSON array with 5 objects. Each object must have question (string), options (array of exactly four strings), correctIndex (zero-based integer), and explanation (string). Do not put the answer in the question or option labels.',
      prompt: `Create a balanced, clear quiz for this study chat titled ${conversation.title}:\n\n${context}`,
      maxOutputTokens: 3000,
      abortSignal: request.signal,
    });
    questions = parseQuestions(result.text);
  } catch {
    return Response.json({ error: 'The quiz could not be generated. Please try again.' }, { status: 502 });
  }
  if (!questions) return Response.json({ error: 'The model returned an unreadable quiz. Please try again.' }, { status: 502 });

  const title = `Practice quiz: ${String(conversation.title).slice(0, 80)}`;
  const { data: quiz, error } = await supabase.from('quiz_sessions').insert({
    user_id: user.id, conversation_id: conversationId, title, questions, answers: {},
  }).select('id,conversation_id,title,questions,answers,created_at,updated_at').single();
  if (error) return Response.json({ error: 'The quiz was created but progress could not be saved.' }, { status: 500 });
  return Response.json({ quiz: toClientQuiz(quiz) }, { status: 201 });
}
