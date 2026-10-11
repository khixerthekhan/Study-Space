alter table public.profiles add column if not exists age smallint;
alter table public.profiles drop constraint if exists profiles_age_range;
alter table public.profiles add constraint profiles_age_range check (age is null or age between 13 and 120);
