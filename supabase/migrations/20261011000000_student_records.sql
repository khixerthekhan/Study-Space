create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New study chat',
  task_mode text not null default 'research' check (task_mode in ('research','journals','assignments','quizzes','slides','career','general')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  citations jsonb not null default '[]'::jsonb,
  task_mode text,
  created_at timestamptz not null default now(),
  unique (conversation_id, client_id)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null,
  extracted_text text not null default '',
  status text not null default 'ready' check (status in ('ready','processing','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  questions jsonb not null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  format text not null check (format in ('docx','pdf')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists materials_user_created_idx on public.materials(user_id, created_at desc);
create index if not exists quizzes_user_created_idx on public.quiz_sessions(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
drop trigger if exists quizzes_updated_at on public.quiz_sessions;
create trigger quizzes_updated_at before update on public.quiz_sessions for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.materials enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.artifacts enable row level security;

create policy "Students manage own profile" on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Students manage own conversations" on public.conversations for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Students manage own messages" on public.messages for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = (select auth.uid())));
create policy "Students manage own materials" on public.materials for all to authenticated
  using (user_id = (select auth.uid()) and (materials.conversation_id is null or exists (select 1 from public.conversations c where c.id = materials.conversation_id and c.user_id = (select auth.uid()))))
  with check (user_id = (select auth.uid()) and (materials.conversation_id is null or exists (select 1 from public.conversations c where c.id = materials.conversation_id and c.user_id = (select auth.uid()))));
create policy "Students manage own quizzes" on public.quiz_sessions for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = quiz_sessions.conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = quiz_sessions.conversation_id and c.user_id = (select auth.uid())));
create policy "Students manage own artifacts" on public.artifacts for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = artifacts.conversation_id and c.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = artifacts.conversation_id and c.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-files', 'student-files', false, 10485760, array['image/png','image/jpeg','text/plain','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Students upload into their own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Students read their own files" on storage.objects for select to authenticated using (
  bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Students delete their own files" on storage.objects for delete to authenticated using (
  bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text
);
