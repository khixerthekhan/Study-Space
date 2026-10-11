alter table public.materials add column if not exists extraction_error text;

create table if not exists public.presentation_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  slides jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{"backgroundColor":"#111827","headingColor":"#f9fafb","bodyColor":"#e5e7eb","includeImages":false}'::jsonb,
  image_warning text,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.presentation_decks add column if not exists image_warning text;
create index if not exists presentation_decks_user_updated_idx on public.presentation_decks(user_id, updated_at desc);
alter table public.presentation_decks enable row level security;
drop policy if exists "Students manage own presentations" on public.presentation_decks;
create policy "Students manage own presentations" on public.presentation_decks for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = presentation_decks.conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = presentation_decks.conversation_id and c.user_id = (select auth.uid())));
drop trigger if exists presentation_decks_updated_at on public.presentation_decks;
create trigger presentation_decks_updated_at before update on public.presentation_decks for each row execute function public.set_updated_at();

alter table public.artifacts drop constraint if exists artifacts_format_check;
alter table public.artifacts add constraint artifacts_format_check check (format in ('docx','pdf','pptx'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-files', 'student-files', false, 26214400, array['image/png','image/jpeg','image/webp','text/plain','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
