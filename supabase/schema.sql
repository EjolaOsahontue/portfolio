
create extension if not exists pgcrypto;

-- 1. Who is the admin?
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid
$$;

-- 2. Tables
create type project_status as enum ('in_progress', 'finished');

create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  color       text not null default '',          -- crate colour, empty = original model colour
  sort_order  int  not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  folder_id     uuid not null references public.folders(id) on delete restrict,
  name          text not null,
  status        project_status not null default 'in_progress',
  color         text not null default '#e63946',  -- sleeve / label colour
  description   text not null default '',
  problem       text not null default '',
  features      text[] not null default '{}',
  tech_stack    text[] not null default '{}',
  learned       text not null default '',
  live_url      text not null default '',
  repo_url      text not null default '',
  cover_image   text not null default '',
  screenshots   text[] not null default '{}',
  sort_order    int  not null default 0,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.site (
  id          int primary key default 1 check (id = 1),
  name        text not null default 'Ejola Osahontue',
  tagline     text not null default '',
  bio         text not null default '',
  skills      text[] not null default '{}',
  email       text not null default '',
  whatsapp    text not null default '',
  github_url  text not null default '',
  itch_url    text not null default '',
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger site_touch before update on public.site
  for each row execute function public.touch_updated_at();

-- 3. Row level security: visitors can only READ published rows; only the admin can write.
alter table public.folders  enable row level security;
alter table public.projects enable row level security;
alter table public.site     enable row level security;

create policy "public reads published folders"  on public.folders
  for select using (published or public.is_admin());
create policy "public reads published projects" on public.projects
  for select using (published or public.is_admin());
create policy "public reads site" on public.site
  for select using (true);

create policy "admin writes folders"  on public.folders
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin writes projects" on public.projects
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin writes site"     on public.site
  for all using (public.is_admin()) with check (public.is_admin());

-- 4. Image storage bucket: anyone can view, only the admin can upload or delete.
insert into storage.buckets (id, name, public)
  values ('portfolio', 'portfolio', true) on conflict (id) do nothing;

create policy "public reads portfolio files" on storage.objects
  for select using (bucket_id = 'portfolio');
create policy "admin writes portfolio files" on storage.objects
  for all using (bucket_id = 'portfolio' and public.is_admin())
  with check (bucket_id = 'portfolio' and public.is_admin());

-- 5. Starting content (matches src/fallback.js). Edit it all later in the admin page.
insert into public.site (id, name, tagline, bio, skills, github_url, itch_url) values (
  1, 'Ejola Osahontue',
  'I make games and the 3D worlds they live in.',
  '[Write 2 or 3 sentences about yourself.]',
  array['Game development','3D modelling','UI and UX design'],
  'https://github.com/EjolaOsahontue', 'https://ejolaosahontue.itch.io'
) on conflict (id) do nothing;

insert into public.folders (slug, name, color, sort_order) values
  ('games',  'Games',  '',        1),
  ('design', 'Design', '#2a9d8f', 2),
  ('2d',     '2D',     '#f4a261', 3),
  ('3d',     '3D',     '#4361ee', 4);

insert into public.projects
  (slug, folder_id, name, status, color, description, problem, features, tech_stack, learned, live_url, sort_order)
select 'bizzy-run', f.id, 'Bizzy Run', 'finished', '#e63946',
  'A fast endless runner I built and published on itch.io.',
  '[Write this in your own words.]',
  array['Responsive player controls','Scoring system','Interactive obstacles','Published on itch.io'],
  array['Unity','C#'],
  '[Write this in your own words.]',
  'https://ejolaosahontue.itch.io/bizzyrun', 1
from public.folders f where f.slug = 'games';

insert into public.projects (slug, folder_id, name, status, color, description, tech_stack, sort_order)
select 'project-two', f.id, 'Project Two', 'in_progress', '#2a9d8f',
  'Describe your second project here.', array['Figma'], 1
from public.folders f where f.slug = 'design';

insert into public.projects (slug, folder_id, name, status, color, description, tech_stack, sort_order)
select 'project-three', f.id, 'Project Three', 'finished', '#4361ee',
  'Describe your third project here.', array['Blender'], 1
from public.folders f where f.slug = '3d';

insert into public.projects (slug, folder_id, name, status, color, description, tech_stack, sort_order)
select 'project-four', f.id, 'Project Four', 'finished', '#f4a261',
  'Describe your fourth project here.', array['Photoshop'], 1
from public.folders f where f.slug = '2d';
