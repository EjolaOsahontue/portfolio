import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// null when the .env values are missing: the site then uses src/fallback.js
export const supabase = url && key ? createClient(url, key) : null

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

// Returns { folders, projects } shaped for main.js, or null (then use the fallback).
export async function loadContent() {
  if (!supabase) return null
  try {
    const [f, p] = await withTimeout(
      Promise.all([
        supabase.from('folders').select('*').eq('published', true).order('sort_order'),
        supabase.from('projects').select('*').eq('published', true).order('sort_order'),
      ]),
      6000
    )
    if (f.error) throw f.error
    if (p.error) throw p.error
    if (!f.data.length) return null

    const byId = new Map(f.data.map((x) => [x.id, x]))
    const folders = f.data.map((x) => ({ name: x.name, color: x.color || null }))
    const projects = p.data
      .filter((x) => byId.has(x.folder_id))
      .map((x) => ({
        id: x.id,
        slug: x.slug,
        name: x.name,
        folder: byId.get(x.folder_id).name,
        status: x.status === 'finished' ? 'Finished' : 'In progress',
        description: x.description,
        tech: x.tech_stack || [],
        color: x.color || '#e63946',
        live: x.live_url || '',
        repo: x.repo_url || '',
        problem: x.problem,
        features: x.features || [],
        learned: x.learned,
        cover: x.cover_image,
        screenshots: x.screenshots || [],
      }))
    return { folders, projects }
  } catch (err) {
    console.warn('Supabase unavailable, using built-in content:', err.message || err)
    return null
  }
}

export async function loadSite() {
  if (!supabase) return null
  try {
    const { data, error } = await withTimeout(supabase.from('site').select('*').eq('id', 1).maybeSingle(), 6000)
    if (error) throw error
    return data
  } catch (err) {
    console.warn('Could not load site info:', err.message || err)
    return null
  }
}
