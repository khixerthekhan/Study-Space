/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireStudent } from '@/lib/supabase/server';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  if (!user) return Response.json({ error: 'Sign in to save quiz progress.' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const answers = body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return Response.json({ error: 'Quiz answers are invalid.' }, { status: 400 });
  const { data: quiz, error: loadError } = await supabase.from('quiz_sessions').select('id,questions').eq('id', id).single();
  if (loadError || !quiz) return Response.json({ error: 'Quiz not found.' }, { status: 404 });

  const safeAnswers: Record<string, number> = {};
  const results = (quiz.questions as any[]).map((question, index) => {
    const choice = Number(answers[index]);
    const valid = Number.isInteger(choice) && choice >= 0 && choice < question.options.length;
    if (valid) safeAnswers[String(index)] = choice;
    return { index, selectedIndex: valid ? choice : null, correctIndex: question.correctIndex, correct: valid && choice === question.correctIndex, explanation: question.explanation };
  });
  const { error } = await supabase.from('quiz_sessions').update({ answers: safeAnswers }).eq('id', id);
  if (error) return Response.json({ error: 'Quiz progress could not be saved.' }, { status: 500 });
  return Response.json({ score: results.filter((result) => result.correct).length, total: results.length, results });
}
