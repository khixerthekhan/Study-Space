-- Repairable setup migration for the private bucket used by uploads and exports.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-files',
  'student-files',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Students upload into their own folder" on storage.objects;
create policy "Students upload into their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Students read their own files" on storage.objects;
create policy "Students read their own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Students delete their own files" on storage.objects;
create policy "Students delete their own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
