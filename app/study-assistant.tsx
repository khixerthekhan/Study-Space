'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useChat } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { markdownPlugins, normalizeMarkdown } from '@/lib/markdown';
import { ColorField, PresentationStudio } from '@/app/presentation-studio';

type ModelKey = 'groq' | 'gemini-pro';
type TaskModeKey = 'research' | 'journals' | 'assignments' | 'quizzes' | 'slides' | 'career' | 'general';
type CapabilityKey = 'auto' | 'fast' | 'balanced' | 'deep';
type ChatPart = { type?: string; text?: string; data?: { model?: string; state?: string; message?: string; title?: string; url?: string; snippet?: string; sourceId?: string }; url?: string; title?: string; sourceId?: string; id?: string; value?: { url?: string; title?: string } };
type ChatMessage = { id: string; role: string; parts?: ChatPart[]; content?: string };
type StudyConversation = { id: string; title: string; task_mode: TaskModeKey };
type StudyMaterial = { id: string; name: string; mime_type: string; size_bytes: number; status?: string; extraction_error?: string | null };
type Artifact = { id: string; title: string; format: 'docx' | 'pdf' | 'pptx'; created_at: string };
type PresentationDeck = { id: string; title: string; slides: { id: string; title: string; bullets: string[]; notes: string; image_alt?: string; image_path?: string | null; image_mime_type?: string; image_url?: string | null }[]; theme: { backgroundColor: string; headingColor: string; bodyColor: string; includeImages: boolean }; citations: { title?: string; url?: string }[]; image_warning?: string | null };
type QuizQuestion = { question: string; options: string[] };
type StudyQuiz = { id: string; title: string; questions: QuizQuestion[]; answers: Record<string, number> };
type QuizResult = { score: number; total: number; results: { index: number; selectedIndex: number | null; correctIndex: number; correct: boolean; explanation: string }[] };

const MODELS: Record<ModelKey, { label: string; provider: string }> = {
  groq: { label: 'GPT-OSS 20B', provider: 'Groq' },
  'gemini-pro': { label: 'Gemini 3.8 Flash', provider: 'Google' },
};
const TASK_MODES: Record<TaskModeKey, { label: string; icon: string }> = {
  research: { label: 'Research', icon: '🔍' }, journals: { label: 'Journals', icon: '📑' }, assignments: { label: 'Assignments', icon: '📝' },
  quizzes: { label: 'Quizzes', icon: '❓' }, slides: { label: 'Slides', icon: '📊' }, career: { label: 'Career Guidance', icon: '🚀' }, general: { label: 'General', icon: '💡' },
};
const CAPABILITIES: Record<CapabilityKey, { label: string; responseMode: string; reasoningMode: string }> = {
  auto: { label: 'Auto depth', responseMode: 'auto', reasoningMode: 'auto' }, fast: { label: 'Fast', responseMode: 'concise', reasoningMode: 'low' },
  balanced: { label: 'Balanced', responseMode: 'normal', reasoningMode: 'medium' }, deep: { label: 'Deep', responseMode: 'detailed', reasoningMode: 'high' },
};
const PROMPTS = [
  'Help me plan an assignment about climate change', 'Create a practice quiz on cell biology with answers',
  'Summarize this journal article and its limitations', 'Build a 6-slide presentation about renewable energy',
];
const ACCEPTED_FILES = '.png,.jpg,.jpeg,.txt,.pdf,.docx';

function textOf(message: ChatMessage) {
  if (Array.isArray(message.parts)) return message.parts.filter((part) => part.type === 'text').map((part) => part.text || '').join('');
  return typeof message.content === 'string' ? message.content : '';
}

function useMarkdownComponents(isUser = false) {
  return useMemo(() => ({
    h1: ({ children }: any) => <h1 className="mb-3 mt-6 text-2xl font-bold tracking-tight">{children}</h1>,
    h2: ({ children }: any) => <h2 className="mb-2 mt-5 text-xl font-semibold">{children}</h2>,
    h3: ({ children }: any) => <h3 className="mb-2 mt-4 text-lg font-semibold">{children}</h3>,
    p: ({ children }: any) => <p className="mb-2 leading-7 last:mb-0">{children}</p>,
    ul: ({ children }: any) => <ul className="mb-3 list-disc space-y-1 pl-6">{children}</ul>,
    ol: ({ children }: any) => <ol className="mb-3 list-decimal space-y-1 pl-6">{children}</ol>,
    li: ({ children }: any) => <li className="pl-1 leading-7">{children}</li>,
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
    blockquote: ({ children }: any) => <blockquote className="my-3 border-l-2 border-indigo-400 pl-4 opacity-90">{children}</blockquote>,
    code: ({ children, className }: any) => <code className={`${className || ''} rounded ${isUser ? 'bg-white/15' : 'bg-black/[0.06]'} px-1.5 py-0.5`}>{children}</code>,
    table: ({ children }: any) => <div className={`my-4 max-w-full overflow-x-auto rounded-xl border ${isUser ? 'border-white/20' : 'border-black/10'}`}><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
    thead: ({ children }: any) => <thead className={isUser ? 'bg-white/10' : 'bg-black/[0.04]'}>{children}</thead>,
    th: ({ children }: any) => <th className={`border-b px-3 py-2.5 font-semibold ${isUser ? 'border-white/20' : 'border-black/10'}`}>{children}</th>,
    td: ({ children }: any) => <td className={`min-w-28 border-b px-3 py-2.5 align-top leading-6 last:border-b-0 ${isUser ? 'border-white/10' : 'border-black/[0.07]'}`}>{children}</td>,
    tr: ({ children }: any) => <tr className={isUser ? 'even:bg-white/[0.04]' : 'even:bg-black/[0.02]'}>{children}</tr>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer" className={isUser ? 'text-indigo-200 underline' : 'text-indigo-700 underline decoration-indigo-500/40 underline-offset-2 hover:text-indigo-900'}>{children}</a>,
    hr: () => <hr className={`my-5 ${isUser ? 'border-white/20' : 'border-black/10'}`} />,
  }), [isUser]);
}

function AuthPanel({ supabase, configError }: { supabase: ReturnType<typeof createSupabaseBrowserClient> | null; configError: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    if (!supabase) return;
    setBusy(true);
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/` } })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else if (mode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account. After confirming, you’ll set up your name and age.');
  }

  async function continueWithGoogle() {
    setError('');
    if (!supabase) return;
    setBusy(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback?next=/` } });
    setBusy(false);
    if (oauthError) setError(oauthError.message);
  }

  return <main className="grid min-h-screen place-items-center bg-[#f7f7f8] px-4 text-[#222]">
    <div className="w-full max-w-md rounded-[28px] border border-black/[0.08] bg-white p-7 shadow-[0_16px_60px_rgba(0,0,0,0.08)]">
      <div className="mb-7 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#171717] font-bold text-white">S</div><div><h1 className="font-semibold">StudySpace</h1><p className="text-xs text-[#777]">Your private academic study space</p></div></div>
      {configError ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Connect Supabase to get started</p><p className="mt-2 text-xs leading-5 text-amber-900/80">Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment, then apply all migrations in <code>supabase/migrations</code>.</p></div> : <>
        <h2 className="text-xl font-semibold">{mode === 'signin' ? 'Welcome back' : 'Create your student account'}</h2>
        <p className="mt-1 text-sm text-[#777]">Your study chats and uploaded materials are saved privately to your account.</p>
        <button type="button" onClick={() => void continueWithGoogle()} disabled={busy || !supabase} className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-[#222] shadow-sm transition hover:bg-[#f8f8f8] disabled:opacity-50"><GoogleMark />{busy ? 'Connecting…' : `${mode === 'signin' ? 'Continue' : 'Sign up'} with Google`}</button>
        <div className="my-5 flex items-center gap-3 text-xs text-[#999]"><span className="h-px flex-1 bg-black/10" />or continue with email<span className="h-px flex-1 bg-black/10" /></div>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-xs font-medium text-[#555]">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40" autoComplete="email" /></label>
          <label className="block text-xs font-medium text-[#555]">Password<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          <button disabled={busy || !supabase} className="w-full rounded-xl bg-[#171717] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50">{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in with email' : 'Create account with email'}</button>
        </form>
        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }} className="mt-4 w-full text-sm text-[#555] hover:text-black">{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
      </>}
    </div>
  </main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" transform="translate(0 4)"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.72 5.99c4.51-4.17 7.06-10.31 7.06-17.64z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19z" transform="translate(0 4)"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.72-5.99C30.04 37.43 27.25 38.5 24 38.5c-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" transform="translate(0 -4)"/></svg>;
}

function ProfileSetup({ onSave }: { onSave: (profile: { display_name: string; age: number }) => void }) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, age: Number(age) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your profile.');
      onSave(data.profile);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your profile.'); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-[#f7f7f8] px-4 text-[#222]"><form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-[28px] border border-black/[0.08] bg-white p-8 shadow-[0_16px_60px_rgba(0,0,0,0.08)]"><div className="mb-7 grid h-12 w-12 place-items-center rounded-2xl bg-[#171717] text-lg font-bold text-white">S</div><p className="text-sm font-medium text-[#777]">One last step</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Tell us about yourself</h1><p className="mt-2 text-sm leading-6 text-[#777]">Set up your student profile so your study space feels like yours.</p><label className="mt-7 block text-sm font-medium">Your name<input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name you go by" className="mt-2 w-full rounded-xl border border-black/10 px-4 py-3 font-normal outline-none focus:border-black/40" /></label><label className="mt-4 block text-sm font-medium">Your age<input required type="number" min={13} max={120} value={age} onChange={(event) => setAge(event.target.value)} placeholder="Age" className="mt-2 w-full rounded-xl border border-black/10 px-4 py-3 font-normal outline-none focus:border-black/40" /><span className="mt-1 block text-xs font-normal text-[#888]">Age is used only for your student profile and age-appropriate study support.</span></label>{error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}<button disabled={busy} className="mt-6 w-full rounded-xl bg-[#171717] px-4 py-3 font-medium text-white hover:bg-black disabled:opacity-50">{busy ? 'Saving profile…' : 'Continue to StudySpace'}</button></form></main>;
}

function QuizCard({ quiz, onUpdate }: { quiz: StudyQuiz; onUpdate: (quiz: StudyQuiz) => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>(quiz.answers || {});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function checkAnswers() {
    setBusy(true); setError('');
    const response = await fetch(`/api/quizzes/${quiz.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || 'Could not save quiz progress.'); return; }
    setResult(data); onUpdate({ ...quiz, answers });
  }
  return <section className="mt-5 rounded-2xl border border-black/[0.07] bg-white p-4 text-[#222] shadow-sm sm:p-5">
    <h3 className="font-semibold">{quiz.title}</h3>
    <div className="mt-4 space-y-5">{quiz.questions.map((question, index) => {
      const checked = result?.results[index];
      return <fieldset key={index} className="space-y-2"><legend className="text-sm font-medium leading-6 text-[#333]">{index + 1}. {question.question}</legend>
        {question.options.map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm ${checked?.correctIndex === optionIndex ? 'bg-emerald-50 text-emerald-800' : checked?.selectedIndex === optionIndex && !checked.correct ? 'bg-rose-50 text-rose-800' : 'text-[#555] hover:bg-black/[0.035]'}`}>
          <input type="radio" name={`quiz-${quiz.id}-${index}`} checked={answers[String(index)] === optionIndex} onChange={() => { setAnswers((old) => ({ ...old, [String(index)]: optionIndex })); setResult(null); }} className="mt-1 accent-indigo-400" />{option}
        </label>)}
        {checked && <p className="rounded-lg bg-[#f7f7f7] p-2.5 text-xs leading-5 text-[#555]">{checked.correct ? 'Correct. ' : 'Review this one. '}{checked.explanation}</p>}
      </fieldset>;
    })}</div>
    {result && <p className="mt-4 text-sm font-semibold text-indigo-800">Score: {result.score} / {result.total}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    <button type="button" disabled={busy || Object.keys(answers).length === 0} onClick={checkAnswers} className="mt-4 rounded-xl bg-[#171717] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">{busy ? 'Checking…' : 'Check answers and save progress'}</button>
  </section>;
}

export default function StudyAssistant() {
  const { supabase, configError } = useMemo(() => {
    try { return { supabase: createSupabaseBrowserClient(), configError: '' }; }
    catch (setupError) { return { supabase: null, configError: setupError instanceof Error ? setupError.message : 'Supabase environment variables are missing.' }; }
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const userId = user?.id;
  const [authLoading, setAuthLoading] = useState(!configError);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileLoadError, setProfileLoadError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<StudyConversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [taskMode, setTaskMode] = useState<TaskModeKey>('research');
  const [selectedModel, setSelectedModel] = useState<ModelKey>('groq');
  const [capability, setCapability] = useState<CapabilityKey>('auto');
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creatingQuiz, setCreatingQuiz] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [documentOfferPrompt, setDocumentOfferPrompt] = useState(false);
  const [handledOfferId, setHandledOfferId] = useState('');
  const [slideSetupPrompt, setSlideSetupPrompt] = useState('');
  const [slideBackground, setSlideBackground] = useState('#111827');
  const [slideHeadingColor, setSlideHeadingColor] = useState('#f9fafb');
  const [slideBodyColor, setSlideBodyColor] = useState('#e5e7eb');
  const [slideImages, setSlideImages] = useState(false);
  const [slideBusy, setSlideBusy] = useState(false);
  const [presentation, setPresentation] = useState<PresentationDeck | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { messages, sendMessage, setMessages, status, error } = useChat();
  const markdownComponents = useMarkdownComponents();
  const userMarkdownComponents = useMarkdownComponents(true);
  const isGenerating = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(({ data }) => { if (active) { setUser(data.user); setAuthLoading(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null); setAuthLoading(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProfileLoading(true); setProfileLoadError('');
      try {
        const response = await fetch('/api/profile');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your profile.');
        if (active) {
          setProfileName(data.profile?.display_name || '');
          setProfileComplete(Boolean(data.profile?.display_name && data.profile?.age));
          setProfileLoading(false);
        }
      } catch (failure) {
        if (active) { setProfileLoadError(failure instanceof Error ? failure.message : 'Could not load your profile.'); setProfileLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [userId]);

  const loadConversations = useCallback(async () => {
    const response = await fetch('/api/conversations');
    if (!response.ok) return;
    const data = await response.json();
    setConversations(data.conversations || []);
    if (!conversationId) {
      const materialsResponse = await fetch('/api/uploads');
      if (materialsResponse.ok) {
        const materialsData = await materialsResponse.json();
        setMaterials(materialsData.materials || []);
        setSelectedMaterialIds((materialsData.materials || []).map((item: StudyMaterial) => item.id));
      }
    }
  }, [conversationId]);

  const loadConversation = useCallback(async (id: string) => {
    const response = await fetch(`/api/conversations/${id}`);
    const data = await response.json();
    if (!response.ok) { setActionError(data.error || 'Could not load study chat.'); return; }
    const restored: any[] = (data.messages || []).map((message: any) => ({
      id: message.client_id,
      role: message.role,
      parts: [
        { type: 'text', text: message.content || '' },
        ...(message.citations || []).map((source: any, index: number) => ({ type: 'data-source', id: `saved-${index}`, data: { sourceId: `saved-${index}`, title: source.title, url: source.url, snippet: source.snippet } })),
      ],
    }));
    setConversationId(id); setTaskMode(data.conversation.task_mode); setMessages(restored);
    setMaterials(data.materials || []); setSelectedMaterialIds((data.materials || []).map((item: StudyMaterial) => item.id));
    const presentationResponse = await fetch(`/api/presentations?conversationId=${id}`);
    const presentationData = await presentationResponse.json();
    setPresentation(presentationData.deck || null);
    setDocumentOfferPrompt(false); setHandledOfferId(''); setActionError(''); setActionNotice('');
    const [artifactResponse, quizResponse] = await Promise.all([fetch(`/api/artifacts?conversationId=${id}`), fetch(`/api/quizzes?conversationId=${id}`)]);
    const artifactData = await artifactResponse.json(); const quizData = await quizResponse.json();
    setArtifacts(artifactData.artifacts || []); setQuizzes(quizData.quizzes || []);
  }, [setMessages]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => { void loadConversations(); }, 0);
    return () => window.clearTimeout(timer);
  }, [user, loadConversations]);

  async function createConversation(title: string) {
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, taskMode }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start a saved study chat.');
    const created = data.conversation as StudyConversation;
    setConversations((old) => [created, ...old]); setConversationId(created.id); setMaterials([]); setSelectedMaterialIds([]); setArtifacts([]); setQuizzes([]);
    return created.id;
  }

  function newChat() {
    setConversationId(''); setMessages([]); setMaterials([]); setSelectedMaterialIds([]); setArtifacts([]); setQuizzes([]); setDocumentOfferPrompt(false); setHandledOfferId(''); setActionError(''); setActionNotice(''); setPresentation(null); setSlideSetupPrompt('');
    void fetch('/api/uploads').then(async (response) => { if (response.ok) { const data = await response.json(); setMaterials(data.materials || []); setSelectedMaterialIds((data.materials || []).map((item: StudyMaterial) => item.id)); } });
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || isGenerating || uploading) return;
    setUploading(true); setActionError(''); setActionNotice('');
    try {
      let activeConversation = conversationId;
      if (!activeConversation) activeConversation = await createConversation(files[0].name.replace(/\.[^.]+$/, '').slice(0, 90));
      for (const file of Array.from(files)) {
        const formData = new FormData(); formData.set('file', file); formData.set('conversationId', activeConversation);
        const response = await fetch('/api/uploads', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(`${file.name}: ${data.error || 'Upload failed.'}`);
        const material = data.material as StudyMaterial;
        setMaterials((old) => [...old, material]); setSelectedMaterialIds((old) => [...old, material.id]);
        if (data.warning) setActionNotice(`${file.name} was saved, but it is not readable as chat context. ${data.warning}`);
      }
      await loadConversations();
    } catch (uploadError) { setActionError(uploadError instanceof Error ? uploadError.message : 'Upload failed.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  function lastAssistantOffersDocument() {
    const last = (messages as ChatMessage[]).at(-1);
    return Boolean(last?.role === 'assistant' && last.id !== handledOfferId && /Would you like me to create a Word file, a PDF, or both/i.test(textOf(last)));
  }

  async function createDocuments(format: 'pdf' | 'docx' | 'both', consentText: string) {
    if (!conversationId) throw new Error('Select a saved chat before creating a document.');
    const response = await fetch('/api/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, format, consentText }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not create the requested file.');
    const created = data.artifacts as Artifact[];
    setArtifacts((old) => [...created, ...old]); setActionNotice(`Created ${created.map((item) => item.format.toUpperCase()).join(' and ')} from this conversation.`);
    setMessages((old) => [...old,
      { id: data.consent.id, role: 'user', parts: [{ type: 'text', text: data.consent.content }] },
      { id: data.confirmation.id, role: 'assistant', parts: [{ type: 'text', text: data.confirmation.content }] },
    ]);
  }

  async function submitMessage(text: string) {
    const value = text.trim();
    if (!value || isGenerating) return;
    setActionError(''); setActionNotice(''); setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    if (taskMode === 'slides') {
      setSlideSetupPrompt(value);
      return;
    }

    const directDocumentRequest = /\b(create|make|generate|export|download|prepare)\b/i.test(value) && /\b(word|docx|pdf|both)\b/i.test(value);
    const pendingOffer = documentOfferPrompt || lastAssistantOffersDocument() || directDocumentRequest;
    if (pendingOffer) {
      const affirmative = /^(yes|yeah|yep|sure|please|make|create|generate|export|both|word|pdf|\.docx|can you|could you|i want)/i.test(value);
      const negative = /^(no|not now|later|skip|don't|do not)/i.test(value);
      const offerId = (messages as ChatMessage[]).at(-1)?.id || '';
      if (negative) { setDocumentOfferPrompt(false); setHandledOfferId(offerId); }
      else if (affirmative && /\b(word|docx|pdf|both)\b/i.test(value)) {
        const format = /\bboth\b/i.test(value) ? 'both' : /\b(pdf)\b/i.test(value) ? 'pdf' : 'docx';
        setDocumentBusy(true);
        try { await createDocuments(format, value); setDocumentOfferPrompt(false); setHandledOfferId(offerId); }
        catch (documentError) { setActionError(documentError instanceof Error ? documentError.message : 'Document creation failed.'); }
        finally { setDocumentBusy(false); }
        return;
      } else if (affirmative) {
        setDocumentOfferPrompt(true);
        setActionNotice('Which format would you like: Word, PDF, or both?');
        return;
      }
    }

    try {
      const activeConversation = conversationId || await createConversation(value.slice(0, 90));
      if (pendingOffer && !/\b(word|docx|pdf|both)\b/i.test(value)) setDocumentOfferPrompt(false);
      sendMessage({ text: value }, { body: {
        userModelChoice: selectedModel, taskMode,
        responseMode: CAPABILITIES[capability].responseMode,
        reasoningMode: CAPABILITIES[capability].reasoningMode,
        conversationId: activeConversation, materialIds: selectedMaterialIds,
      } });
      void loadConversations();
    } catch (submitError) { setActionError(submitError instanceof Error ? submitError.message : 'Could not send this message.'); }
  }

  async function createPresentation() {
    const prompt = slideSetupPrompt.trim();
    if (!prompt || slideBusy) return;
    setSlideBusy(true); setActionError(''); setActionNotice('');
    try {
      const activeConversation = conversationId || await createConversation(prompt.slice(0, 90));
      const response = await fetch('/api/presentations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: activeConversation, prompt, theme: { backgroundColor: slideBackground, headingColor: slideHeadingColor, bodyColor: slideBodyColor }, includeImages: slideImages }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create the presentation.');
      setPresentation(data.deck); setSlideSetupPrompt('');
      setMessages((old) => [...old, { id: `slide-request-${Date.now()}`, role: 'user', parts: [{ type: 'text', text: prompt }] }]);
      setTaskMode('slides');
      if (data.warning) setActionNotice(data.warning);
      void loadConversations();
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Could not create the presentation.'); }
    finally { setSlideBusy(false); }
  }

  async function createInteractiveQuiz() {
    if (!conversationId || creatingQuiz) return;
    setCreatingQuiz(true); setActionError('');
    const response = await fetch('/api/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) });
    const data = await response.json(); setCreatingQuiz(false);
    if (!response.ok) { setActionError(data.error || 'Could not start a quiz.'); return; }
    setQuizzes((old) => [data.quiz, ...old]);
  }

  async function signOut() { await supabase?.auth.signOut(); newChat(); }

  if (authLoading || (user && profileLoading)) return <main className="grid min-h-screen place-items-center bg-[#f7f7f8] text-sm text-[#777]">Preparing your study space…</main>;
  if (!user) return <AuthPanel supabase={supabase} configError={configError} />;
  if (!profileComplete) return <><ProfileSetup onSave={(profile) => { setProfileName(profile.display_name); setProfileComplete(true); setProfileLoadError(''); }} />{profileLoadError && <div role="alert" className="fixed inset-x-4 top-4 z-10 mx-auto max-w-lg rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{profileLoadError}</div>}</>;

  const sidebarModes: TaskModeKey[] = ['assignments','quizzes','research','journals','slides','career','general'];
  return <main className="flex h-dvh overflow-hidden bg-[#f7f7f8] text-[#202020] selection:bg-black selection:text-white">
    {sidebarOpen && <button aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/30 md:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[270px] shrink-0 flex-col border-r border-black/[0.06] bg-[#f0f0f0] px-3 py-3 transition-transform duration-200 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-14 items-center gap-2.5 px-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-[#171717] text-sm font-bold text-white">S</div><span className="flex-1 font-serif text-[22px] font-semibold tracking-tight" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>StudySpace</span><button type="button" onClick={() => setSidebarOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-[#666] hover:bg-black/[0.06] md:hidden" aria-label="Close sidebar">×</button></div>
      <button type="button" onClick={() => { newChat(); setSidebarOpen(false); }} className="mt-3 flex h-11 items-center gap-3 rounded-xl bg-white px-3 text-sm font-medium shadow-sm transition hover:bg-white/80"><span className="text-lg leading-none">＋</span>New chat<span className="ml-auto text-xs text-[#999]">✎</span></button>
      <div className="mt-6 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#929292]">Study tools</div>
      <nav aria-label="Study tools" className="mt-2 space-y-0.5">{sidebarModes.map((mode) => { const featured = mode === 'assignments' || mode === 'quizzes'; return <button key={mode} type="button" onClick={() => { if (messages.length) newChat(); setTaskMode(mode); setSidebarOpen(false); }} className={`flex w-full items-center rounded-xl px-3 text-left transition ${featured ? 'min-h-11 py-2 text-[15px] font-semibold' : 'min-h-9 py-2 text-[13px] font-normal'} ${taskMode === mode ? 'bg-white text-[#171717] shadow-sm' : `${featured ? 'text-[#333]' : 'text-[#555]'} hover:bg-black/[0.045] hover:text-[#222]`}`}><span>{TASK_MODES[mode].label}</span></button>; })}</nav>
      <div className="mb-2 mt-7 flex items-center px-2"><span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#929292]">Chat history</span><span className="text-[10px] text-[#aaa]">{conversations.length || ''}</span></div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{conversations.length ? conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => { void loadConversation(conversation.id); setSidebarOpen(false); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition ${conversation.id === conversationId ? 'bg-black/[0.07] text-[#171717]' : 'text-[#626262] hover:bg-black/[0.04] hover:text-[#222]'}`}><span className="shrink-0 text-[11px] opacity-60">◷</span><span className="truncate">{conversation.title}</span></button>) : <p className="px-3 py-2 text-xs leading-5 text-[#9a9a9a]">Your saved chats will show here.</p>}</div>
      <div className="mt-3 border-t border-black/[0.07] pt-3"><div className="flex items-center gap-2 rounded-xl px-2 py-2"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#d9d9d9] text-xs font-semibold text-[#333]">{profileName.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{profileName}</p><p className="truncate text-[10px] text-[#888]">{user.email}</p></div><button type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-lg text-[#777] hover:bg-black/[0.06] hover:text-[#222]">↪</button></div></div>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-black/[0.05] bg-[#f7f7f8]/90 px-4 backdrop-blur-xl sm:px-7">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3">
          <button type="button" onClick={() => setSidebarOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-[#555] hover:bg-black/[0.05] md:hidden" aria-label="Open sidebar">☰</button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">{TASK_MODES[taskMode].label}</div>
          <span className="hidden rounded-full bg-white px-3 py-1.5 text-[11px] text-[#777] shadow-sm sm:inline-flex">Private study space</span>
        </div>
      </header>
      <section className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 pb-8 pt-5 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <select aria-label="Saved study chats" value={conversationId} onChange={(event) => event.target.value ? void loadConversation(event.target.value) : newChat()} className="hidden min-w-48 max-w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-xs text-[#555] outline-none">
              <option value="">New study chat</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
            </select>
            <span className="rounded-full bg-white px-3 py-1.5 text-[11px] text-[#777] shadow-sm">Saved privately</span>
          </div>

          {messages.length === 0 ? <div className="flex min-h-[42vh] flex-col items-center justify-center text-center">
            <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-white text-2xl shadow-sm">✦</div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">What are we studying today{profileName ? `, ${profileName.split(' ')[0]}` : ''}?</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-[#777]">Choose a study tool from the sidebar, add class materials, or ask in your own words.</p>
            <div className="mt-7 grid w-full max-w-3xl gap-2 sm:grid-cols-2">{PROMPTS.map((prompt) => <button key={prompt} onClick={() => { setInput(prompt); window.setTimeout(() => textareaRef.current?.focus(), 0); }} className="rounded-2xl border border-black/[0.07] bg-white p-4 text-left text-[13px] leading-5 text-[#4f4f4f] shadow-sm transition hover:border-black/15 hover:bg-[#fcfcfc]">↗ <span className="ml-1.5">{prompt}</span></button>)}</div>
          </div> : <div className="space-y-8">{(messages as ChatMessage[]).map((message) => {
            const isUser = message.role === 'user'; const parts = message.parts || [];
            const statusParts = parts.filter((part) => part.type === 'data-status'); const modelParts = parts.filter((part) => part.type === 'data-model');
            const sources = parts.filter((part) => part.type === 'data-source' || part.type === 'source-url' || part.type === 'source');
            const latestStatus = statusParts.at(-1); const modelName = modelParts.at(-1)?.data?.model || MODELS[selectedModel].label; const messageText = textOf(message);
            return <article key={message.id} className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 break-words ${isUser ? 'max-w-[88%] rounded-[24px] bg-[#171717] px-5 py-3.5 text-white shadow-sm sm:max-w-[78%]' : 'w-full max-w-[98%] rounded-2xl border border-black/[0.06] bg-white px-5 py-4 text-[#222] shadow-[0_1px_3px_rgba(0,0,0,0.035)] sm:px-6'}`}>
                {!isUser && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#777]"><span className="grid h-5 w-5 place-items-center rounded-md bg-[#f0f0f0] text-[10px] text-[#444]">S</span>{modelName}</div>}
                {!isUser && latestStatus && <div className="mb-3 flex items-center gap-2 text-xs text-[#777]"><span className={`h-2 w-2 rounded-full ${latestStatus.data?.state === 'complete' ? 'bg-emerald-500' : 'animate-pulse bg-indigo-500'}`} /><span>{latestStatus.data?.message}</span></div>}
                {!isUser && sources.length > 0 && <details className="mb-3 rounded-xl border border-black/[0.08] bg-[#fafafa] p-3"><summary className="cursor-pointer text-xs font-semibold text-[#444]">Sources · {sources.length}</summary><div className="mt-2 space-y-2">{sources.map((source, index) => { const url = source.data?.url || source.url || source.value?.url; const title = source.data?.title || source.title || source.value?.title || url || 'Source'; const snippet = source.data?.snippet; return <div key={source.data?.sourceId || source.sourceId || index} className="rounded-lg border border-black/[0.06] bg-white p-2.5"><a href={url || '#'} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-700 hover:underline">{title}</a>{snippet && <p className="mt-1.5 text-xs leading-5 text-[#666]">{snippet}</p>}</div>; })}</div></details>}
                {messageText && <div className="break-words text-base leading-7"><ReactMarkdown remarkPlugins={[remarkGfm, ...markdownPlugins] as any} components={isUser ? userMarkdownComponents : markdownComponents}>{normalizeMarkdown(messageText)}</ReactMarkdown></div>}
              </div>
            </article>;
          })}</div>}

          {slideSetupPrompt && <section className="mt-6 rounded-3xl border border-black/[0.08] bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Set up your presentation</h3><p className="mt-1 text-xs text-[#777]">The deck will use relevant context from this entire chat.</p></div><button type="button" onClick={() => setSlideSetupPrompt('')} className="rounded-lg px-3 py-2 text-xs text-[#777] hover:bg-black/[0.05]">Cancel</button></div><label className="mt-4 block text-xs text-[#666]">Topic or instructions<textarea value={slideSetupPrompt} onChange={(e) => setSlideSetupPrompt(e.target.value)} rows={3} className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#fafafa] p-3 text-sm text-[#222] outline-none focus:border-black/30" /></label><div className="mt-4 grid gap-3 sm:grid-cols-3"><ColorField label="Background color:" value={slideBackground} onChange={setSlideBackground} /><ColorField label="Headings text color:" value={slideHeadingColor} onChange={setSlideHeadingColor} /><ColorField label="Other text color:" value={slideBodyColor} onChange={setSlideBodyColor} /></div><div className="mt-4 flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs text-[#555]"><input type="checkbox" checked={slideImages} onChange={(e) => setSlideImages(e.target.checked)} className="accent-black" /> Add AI-generated topic images</label><button type="button" disabled={slideBusy || !slideSetupPrompt.trim()} onClick={() => void createPresentation()} className="ml-auto rounded-xl bg-[#171717] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{slideBusy ? 'Creating your deck…' : 'Create presentation'}</button></div><p className="mt-3 text-[11px] text-[#888]">Images are optional and generated only when enabled. You can edit slides and reorder them after generation.</p></section>}
          {presentation && <PresentationStudio key={presentation.id} initialDeck={presentation} onClose={() => setPresentation(null)} onArtifact={(artifact) => { setArtifacts((old) => [artifact, ...old]); setActionNotice('Editable PowerPoint saved privately to your account.'); }} />}

          {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error.message || 'The request could not be completed. Please try again.'}</div>}
          {actionError && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</div>}
          {actionNotice && <div role="status" className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">{actionNotice}</div>}

          {artifacts.length > 0 && <section className="mt-6 rounded-2xl border border-black/[0.07] bg-white p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-[#777]">Saved study files</h3><div className="mt-3 flex flex-wrap gap-2">{artifacts.map((artifact) => <a key={artifact.id} href={`/api/artifacts/${artifact.id}`} className="rounded-lg border border-black/10 bg-[#f8f8f8] px-3 py-2 text-xs text-[#333] hover:bg-[#eee]">↓ {artifact.title}.{artifact.format}</a>)}</div></section>}

          {taskMode === 'quizzes' && messages.length > 0 && <div className="mt-6"><button type="button" onClick={createInteractiveQuiz} disabled={creatingQuiz || !conversationId} className="rounded-xl bg-[#171717] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">{creatingQuiz ? 'Building questions…' : 'Start an interactive quiz from this chat'}</button>{quizzes.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} onUpdate={(updated) => setQuizzes((old) => old.map((item) => item.id === updated.id ? updated : item))} />)}</div>}
        </div>
      </section>

      <div className="shrink-0 px-3 pb-3 pt-2 sm:px-6 sm:pb-5"><div className="mx-auto w-full max-w-3xl">
        <div className="overflow-hidden rounded-[26px] border border-black/[0.1] bg-white shadow-[0_4px_18px_rgba(0,0,0,0.07)] focus-within:border-black/25">
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">{materials.map((material) => <button key={material.id} type="button" title={material.extraction_error || 'Click to include or exclude this file'} onClick={() => setSelectedMaterialIds((old) => old.includes(material.id) ? old.filter((id) => id !== material.id) : [...old, material.id])} className={`max-w-full truncate rounded-lg border px-2 py-1 text-[10px] ${material.status === 'failed' ? 'border-amber-200 bg-amber-50 text-amber-800' : selectedMaterialIds.includes(material.id) ? 'border-black/10 bg-[#f2f2f2] text-[#333]' : 'border-black/[0.07] text-[#999]'}`}>{material.status === 'failed' ? '⚠ ' : selectedMaterialIds.includes(material.id) ? '✓ ' : ''}{material.name} · {(material.size_bytes / 1024).toFixed(0)} KB</button>)}</div>
          <form onSubmit={(event) => { event.preventDefault(); void submitMessage(input); }}>
            <div className="px-4 pt-2"><textarea ref={textareaRef} value={input} onChange={(event) => { setInput(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`; }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitMessage(input); } }} placeholder={documentOfferPrompt ? 'Choose Word, PDF, or both…' : `Message about ${TASK_MODES[taskMode].label.toLowerCase()}…`} rows={1} disabled={isGenerating || documentBusy} className="max-h-40 min-h-12 w-full resize-none border-0 bg-transparent py-2 text-[15px] leading-6 text-[#222] outline-none placeholder:text-[#999] disabled:opacity-50" aria-label="Message" /></div>
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
              <input ref={fileRef} type="file" accept={ACCEPTED_FILES} multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || isGenerating} className="rounded-xl border border-black/10 px-3 py-2 text-xs text-[#555] hover:bg-[#f5f5f5] disabled:opacity-40">{uploading ? 'Uploading…' : '＋ Add materials'}</button>
              <select aria-label="AI model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value as ModelKey)} disabled={isGenerating} className="max-w-40 rounded-xl border border-black/10 bg-white px-2.5 py-2 text-xs text-[#555]">{Object.entries(MODELS).map(([key, model]) => <option key={key} value={key}>{model.label} · {model.provider}</option>)}</select>
              <select aria-label="Answer depth" value={capability} onChange={(event) => setCapability(event.target.value as CapabilityKey)} disabled={isGenerating} className="max-w-32 rounded-xl border border-black/10 bg-white px-2.5 py-2 text-xs text-[#555]">{Object.entries(CAPABILITIES).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select>
              <div className="flex-1" />
              {(isGenerating || documentBusy) && <span className="px-2 text-xs text-[#777]">{documentBusy ? 'Preparing your file…' : 'Working…'}</span>}
              <button type="submit" aria-label="Send message" disabled={!input.trim() || isGenerating || documentBusy} className="grid h-9 w-9 place-items-center rounded-full bg-[#171717] text-lg text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-[#ccc]">↑</button>
            </div>
          </form>
        </div>
        <p className="mt-2 text-center text-[10px] text-[#999]">PNG, JPG, TXT, PDF, DOCX · Enter to send · Shift + Enter for a new line</p>
      </div></div>
    </div>
  </main>;
}
