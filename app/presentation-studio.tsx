'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';

type Slide = { id: string; title: string; bullets: string[]; notes: string; image_alt?: string; image_path?: string | null; image_mime_type?: string; image_url?: string | null };
type Deck = { id: string; title: string; slides: Slide[]; theme: { backgroundColor: string; headingColor: string; bodyColor: string; includeImages: boolean }; citations: { title?: string; url?: string }[]; image_warning?: string | null };

const SUGGESTED_COLORS = [
  { name: 'Midnight', value: '#111827' }, { name: 'Ink', value: '#172554' }, { name: 'Slate', value: '#334155' },
  { name: 'White', value: '#FFFFFF' }, { name: 'Warm white', value: '#F8FAFC' }, { name: 'Sky', value: '#BAE6FD' },
  { name: 'Indigo', value: '#A5B4FC' }, { name: 'Mint', value: '#A7F3D0' }, { name: 'Amber', value: '#FDE68A' },
  { name: 'Rose', value: '#FDA4AF' }, { name: 'Violet', value: '#C4B5FD' }, { name: 'Teal', value: '#5EEAD4' },
];

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  function update(next: string) {
    setDraft(next);
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toUpperCase());
  }
  return <label className="block min-w-44 flex-1 text-xs text-zinc-400">{label}
    <div className="mt-1.5 flex gap-2">
      <input aria-label={label} value={draft} onChange={(event) => update(event.target.value)} onBlur={() => { if (!/^#[0-9a-f]{6}$/i.test(draft)) setDraft(value); }} placeholder="#112233" maxLength={7} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-indigo-400" />
      <select aria-label={`${label} suggested colors`} value="" onChange={(event) => { if (event.target.value) update(event.target.value); }} className="max-w-36 rounded-lg border border-white/10 bg-[#17171d] px-2 text-xs text-zinc-200">
        <option value="">Suggested colors</option>{SUGGESTED_COLORS.map((color) => <option key={color.value} value={color.value}>{color.name} · {color.value}</option>)}
      </select>
    </div>
  </label>;
}

function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16) / 255) || [0, 0, 0];
    const values = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function PresentationStudio({ initialDeck, onClose, onArtifact }: { initialDeck: Deck; onClose: () => void; onArtifact: (artifact: { id: string; title: string; format: 'pptx'; created_at: string }) => void }) {
  const [deck, setDeck] = useState(initialDeck);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState('Saved');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const slide = deck.slides[index];
  const lowContrast = Math.min(contrastRatio(deck.theme.backgroundColor, deck.theme.headingColor), contrastRatio(deck.theme.backgroundColor, deck.theme.bodyColor)) < 4.5;
  const snapshot = useMemo(() => JSON.stringify(deck), [deck]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setSaveState('Saving…'); setError('');
      try {
        const response = await fetch(`/api/presentations/${deck.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deck) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not autosave this draft.');
        setSaveState('Saved');
      } catch (saveError) { setSaveState('Not saved'); setError(saveError instanceof Error ? saveError.message : 'Could not autosave this draft.'); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [snapshot, deck]);

  function updateSlide(changes: Partial<Slide>) {
    setDeck((old) => ({ ...old, slides: old.slides.map((item, i) => i === index ? { ...item, ...changes } : item) }));
  }
  function moveSlide(direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= deck.slides.length) return;
    const slides = [...deck.slides]; [slides[index], slides[target]] = [slides[target], slides[index]];
    setDeck((old) => ({ ...old, slides })); setIndex(target);
  }
  async function exportPptx() {
    setExporting(true); setError('');
    try {
      const response = await fetch(`/api/presentations/${deck.id}/export`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'PowerPoint export failed.');
      onArtifact(data.artifact); setSaveState('Saved');
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'PowerPoint export failed.'); }
    finally { setExporting(false); }
  }

  return <section className="mt-6 rounded-3xl border border-indigo-400/20 bg-[#111116] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><label className="block text-xs text-zinc-400">Presentation title<input value={deck.title} onChange={(e) => setDeck((old) => ({ ...old, title: e.target.value }))} className="mt-1 block w-full max-w-xl rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-base font-semibold text-white outline-none focus:border-indigo-400" /></label><p className="mt-2 text-xs text-zinc-500">Editable draft · {saveState}</p></div><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-white/5">Close</button></div>
    <div className="mt-5 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 sm:grid-cols-3">
      <ColorField label="Background color:" value={deck.theme.backgroundColor} onChange={(value) => setDeck((old) => ({ ...old, theme: { ...old.theme, backgroundColor: value } }))} />
      <ColorField label="Headings text color:" value={deck.theme.headingColor} onChange={(value) => setDeck((old) => ({ ...old, theme: { ...old.theme, headingColor: value } }))} />
      <ColorField label="Other text color:" value={deck.theme.bodyColor} onChange={(value) => setDeck((old) => ({ ...old, theme: { ...old.theme, bodyColor: value } }))} />
      {lowContrast && <span className="max-w-xs text-xs text-amber-300">These colors may be difficult to read. Choose stronger contrast.</span>}
      {deck.theme.includeImages && <span className="text-xs text-zinc-500">AI images were enabled for this deck.</span>}
    </div>
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.8fr)]">
      <div>
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 p-6 sm:p-9" style={{ backgroundColor: deck.theme.backgroundColor, color: deck.theme.bodyColor }}>
          <p className="text-xs uppercase tracking-[0.18em] opacity-65">{deck.title}</p><h3 className="mt-5 text-xl font-bold leading-tight sm:text-3xl" style={{ color: deck.theme.headingColor }}>{slide?.title}</h3>
          <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: slide?.image_url ? '1.25fr 0.75fr' : '1fr' }}><ul className="space-y-2 text-xs leading-5 sm:text-base sm:leading-7">{slide?.bullets.map((bullet, i) => <li key={i} className="flex gap-2"><span>•</span><span>{bullet}</span></li>)}</ul>{slide?.image_url && <img src={slide.image_url} alt={slide.image_alt || ''} className="max-h-48 w-full rounded-xl object-cover" />}</div>
          <span className="absolute bottom-4 right-5 text-xs opacity-60">{index + 1} / {deck.slides.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Previous</button><button type="button" onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))} disabled={index >= deck.slides.length - 1} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Next</button><button type="button" onClick={() => moveSlide(-1)} disabled={index === 0} className="ml-auto rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Move earlier</button><button type="button" onClick={() => moveSlide(1)} disabled={index >= deck.slides.length - 1} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Move later</button></div>
      </div>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-zinc-400">Slide title<input value={slide?.title || ''} onChange={(e) => updateSlide({ title: e.target.value })} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400" /></label>
        <label className="block text-xs font-medium text-zinc-400">Key points <span className="font-normal">(one per line)</span><textarea value={(slide?.bullets || []).join('\n')} onChange={(e) => updateSlide({ bullets: e.target.value.split('\n').slice(0, 8) })} rows={7} className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-indigo-400" /></label>
        <label className="block text-xs font-medium text-zinc-400">Speaker notes<textarea value={slide?.notes || ''} onChange={(e) => updateSlide({ notes: e.target.value })} rows={3} className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-indigo-400" /></label>
        <p className="text-xs text-zinc-500">{deck.citations?.length || 0} cited sources will be included in the exported deck.</p>
      </div>
    </div>
    {deck.image_warning && <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-3 text-sm text-amber-100">{deck.image_warning}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/[0.06] p-3 text-sm text-rose-200">{error}</p>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-zinc-500">Changes save automatically to your account.</span><button type="button" onClick={() => void exportPptx()} disabled={exporting || saveState === 'Saving…'} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50">{exporting ? 'Preparing PowerPoint…' : 'Download editable PowerPoint'}</button></div>
  </section>;
}
