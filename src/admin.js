import { supabase } from './supabase.js'

const app = document.getElementById('app')
const BUCKET = 'portfolio'
const MAX_MB = 5

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)

let toastTimer
function toast(text, bad = false) {
  const t = document.getElementById('toast')
  t.textContent = text
  t.className = 'show' + (bad ? ' bad' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (t.className = ''), 3500)
}

function friendly(err) {
  const m = (err && err.message) || String(err)
  if (err && err.code === '23503') return 'That folder still has projects in it. Move or delete them first.'
  if (err && err.code === '23505') return 'That slug is already used. Change it so it is unique.'
  if (/row-level security|permission denied|not authorized/i.test(m))
    return 'Permission denied. Are you signed in as the admin user, and is its UUID in is_admin()?'
  return m
}

// ---------- state ----------
const state = { tab: 'projects', folders: [], projects: [], site: null, editing: null }

async function refresh() {
  const [f, p, s] = await Promise.all([
    supabase.from('folders').select('*').order('sort_order'),
    supabase.from('projects').select('*').order('sort_order'),
    supabase.from('site').select('*').eq('id', 1).maybeSingle(),
  ])
  const err = f.error || p.error || s.error
  if (err) throw err
  state.folders = f.data
  state.projects = p.data
  state.site = s.data
}

// ---------- boot ----------
async function boot() {
  if (!supabase) {
    app.innerHTML = `<div class="note"><h1>Admin is not connected yet</h1>
      <p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file,
      then restart <code>npm run dev</code>.</p></div>`
    return
  }
  const { data } = await supabase.auth.getSession()
  if (data.session) await dashboard()
  else loginView()
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') loginView() })
}

function loginView() {
  app.innerHTML = `<div class="login"><h1>Admin sign in</h1><br />
    <form id="login">
      <label>Email<input name="email" type="email" required autocomplete="username" /></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
      <button class="primary" type="submit">Sign in</button>
    </form></div>`
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = e.target.querySelector('button')
    btn.disabled = true
    const fd = new FormData(e.target)
    const { error } = await supabase.auth.signInWithPassword({
      email: fd.get('email'), password: fd.get('password'),
    })
    btn.disabled = false
    if (error) return toast(error.message, true)
    await dashboard()
  })
}

async function dashboard() {
  try { await refresh() } catch (err) { toast(friendly(err), true) }
  render()
}

// ---------- layout ----------
function render() {
  const tabs = [['projects', 'Projects'], ['folders', 'Folders'], ['site', 'About and contact']]
  app.innerHTML = `
    <div class="bar">
      <h1>Portfolio admin</h1>
      <div><a class="btn" href="/" target="_blank" rel="noopener" style="text-decoration:none">View site ↗</a>
        <button id="out">Sign out</button></div>
    </div>
    <div class="tabs">${tabs.map(([k, n]) =>
      `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="panel"></div>`
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab
    state.editing = null
    render()
  }))
  document.getElementById('out').addEventListener('click', () => supabase.auth.signOut())
  const panel = document.getElementById('panel')
  if (state.tab === 'projects') projectsPanel(panel)
  if (state.tab === 'folders') foldersPanel(panel)
  if (state.tab === 'site') sitePanel(panel)
}

// two-click delete (the viewer blocks confirm() dialogs in some places, so build it in)
function armDelete(btn, action) {
  let armed = false
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true
      btn.classList.add('armed')
      btn.textContent = 'Click again to delete'
      setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = 'Delete' }, 4000)
    } else action()
  })
}

async function upload(file, prefix) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Image is over ${MAX_MB} MB. Make it smaller first.`)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000' })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// ---------- PROJECTS ----------
function projectsPanel(panel) {
  if (state.editing) return projectForm(panel, state.editing === 'new' ? {} : state.editing)
  const folderName = (id) => (state.folders.find((f) => f.id === id) || {}).name || '?'
  panel.innerHTML = `
    <button class="primary" id="new">+ New project</button>
    <h2>${state.projects.length} project${state.projects.length === 1 ? '' : 's'}</h2>
    ${state.projects.map((p) => `
      <div class="row">
        <span class="dot" style="background:${esc(p.color)}"></span>
        <div class="grow"><strong>${esc(p.name)}</strong><br />
          <small>${esc(folderName(p.folder_id))} · ${p.status === 'finished' ? 'Finished' : 'In progress'}</small></div>
        <span class="pill ${p.published ? '' : 'draft'}">${p.published ? 'Live' : 'Hidden'}</span>
        <button data-edit="${p.id}">Edit</button>
      </div>`).join('') || '<p>No projects yet.</p>'}`
  document.getElementById('new').addEventListener('click', () => {
    if (!state.folders.length) return toast('Create a folder first (Folders tab).', true)
    state.editing = 'new'
    render()
  })
  panel.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    state.editing = state.projects.find((p) => p.id === b.dataset.edit)
    render()
  }))
}

function projectForm(panel, p) {
  const isNew = !p.id
  panel.innerHTML = `
    <h2>${isNew ? 'New project' : 'Edit ' + esc(p.name)}</h2>
    <form id="pf">
      <div class="two">
        <label>Name<input name="name" required value="${esc(p.name)}" /></label>
        <label>Slug <small>used in the page address, e.g. bizzy-run</small>
          <input name="slug" value="${esc(p.slug)}" placeholder="auto from the name" /></label>
      </div>
      <div class="two">
        <label>Folder<select name="folder_id">${state.folders.map((f) =>
          `<option value="${f.id}" ${f.id === p.folder_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <label>Status<select name="status">
          <option value="in_progress" ${p.status !== 'finished' ? 'selected' : ''}>In progress (test pressing)</option>
          <option value="finished" ${p.status === 'finished' ? 'selected' : ''}>Finished (pressed)</option></select></label>
      </div>
      <div class="two">
        <label>Sleeve colour<input type="color" name="color" value="${esc(p.color || '#e63946')}" /></label>
        <label>Order in its crate <small>smaller shows first</small>
          <input type="number" name="sort_order" value="${p.sort_order ?? 0}" /></label>
      </div>
      <label>Short description <small>shown big when the record plays</small>
        <textarea name="description" rows="3">${esc(p.description)}</textarea></label>
      <label>Problem it solved<textarea name="problem" rows="3">${esc(p.problem)}</textarea></label>
      <label>Features <small>one per line</small>
        <textarea name="features" rows="4">${esc((p.features || []).join('\n'))}</textarea></label>
      <label>Technologies <small>separate with commas</small>
        <input name="tech_stack" value="${esc((p.tech_stack || []).join(', '))}" /></label>
      <label>What I learned<textarea name="learned" rows="3">${esc(p.learned)}</textarea></label>
      <div class="two">
        <label>Live link<input name="live_url" type="url" placeholder="https://" value="${esc(p.live_url)}" /></label>
        <label>Code repository<input name="repo_url" type="url" placeholder="https://" value="${esc(p.repo_url)}" /></label>
      </div>
      <label>Cover image <small>shown at the top of the project's own page. Paste a link or upload one below</small>
        <input name="cover_image" value="${esc(p.cover_image)}" />
        <input type="file" id="coverFile" accept="image/*" />
        <img class="thumb" id="coverPrev" alt="" ${p.cover_image ? `src="${esc(p.cover_image)}"` : 'hidden'} /></label>
      <label>Screenshot URLs <small>one per line, or upload several</small>
        <textarea name="screenshots" id="shots" rows="3">${esc((p.screenshots || []).join('\n'))}</textarea>
        <input type="file" id="shotFiles" accept="image/*" multiple />
        <span class="thumbs" id="shotPrev"></span></label>
      <label class="check"><input type="checkbox" name="published" ${p.published !== false ? 'checked' : ''} />
        Visible on the site</label>
      <div class="actions">
        <button class="primary" type="submit">Save</button>
        <button type="button" id="cancel">Cancel</button>
        ${isNew ? '' : '<button type="button" class="danger" id="del">Delete</button>'}
      </div>
    </form>`

  const form = document.getElementById('pf')
  const slugBase = () => slugify(form.name.value) || 'project'

  // live image previews, so you can SEE that the links work
  const coverPrev = document.getElementById('coverPrev')
  const shotPrev = document.getElementById('shotPrev')
  const shotBox = document.getElementById('shots')
  const showCover = () => {
    const u = form.cover_image.value.trim()
    if (u) { coverPrev.src = u; coverPrev.hidden = false } else { coverPrev.removeAttribute('src'); coverPrev.hidden = true }
  }
  const showShots = () => {
    shotPrev.replaceChildren(...lines(shotBox.value).map((u) => {
      const i = document.createElement('img')
      i.className = 'thumb'
      i.alt = ''
      i.src = u
      return i
    }))
  }
  coverPrev.addEventListener('error', () => toast('The cover image link does not load. Check the URL.', true))
  form.cover_image.addEventListener('input', showCover)
  shotBox.addEventListener('input', showShots)
  showShots()

  document.getElementById('cancel').addEventListener('click', () => { state.editing = null; render() })
  if (!isNew) armDelete(document.getElementById('del'), async () => {
    const { error } = await supabase.from('projects').delete().eq('id', p.id)
    if (error) return toast(friendly(error), true)
    toast('Deleted.')
    state.editing = null
    await dashboard()
  })

  document.getElementById('coverFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      toast('Uploading…')
      form.cover_image.value = await upload(file, `projects/${form.slug.value || slugBase()}`)
      showCover()
      toast('Cover uploaded. Press Save to keep it.')
    } catch (err) { toast(friendly(err), true) }
  })
  document.getElementById('shotFiles').addEventListener('change', async (e) => {
    const files = [...e.target.files]
    if (!files.length) return
    try {
      toast('Uploading…')
      const urls = []
      for (const f of files) urls.push(await upload(f, `projects/${form.slug.value || slugBase()}`))
      const box = document.getElementById('shots')
      box.value = [...lines(box.value), ...urls].join('\n')
      showShots()
      toast('Screenshots uploaded. Press Save to keep them.')
    } catch (err) { toast(friendly(err), true) }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const row = {
      name: fd.get('name').trim(),
      slug: slugify(fd.get('slug') || '') || slugBase(),
      folder_id: fd.get('folder_id'),
      status: fd.get('status'),
      color: fd.get('color'),
      sort_order: Number(fd.get('sort_order')) || 0,
      description: fd.get('description').trim(),
      problem: fd.get('problem').trim(),
      features: lines(fd.get('features')),
      tech_stack: csv(fd.get('tech_stack')),
      learned: fd.get('learned').trim(),
      live_url: fd.get('live_url').trim(),
      repo_url: fd.get('repo_url').trim(),
      cover_image: fd.get('cover_image').trim(),
      screenshots: lines(fd.get('screenshots')),
      published: fd.get('published') === 'on',
    }
    if (!isNew) row.id = p.id
    const btn = form.querySelector('button[type=submit]')
    btn.disabled = true
    const { error } = await supabase.from('projects').upsert(row)
    btn.disabled = false
    if (error) return toast(friendly(error), true)
    toast('Saved.')
    state.editing = null
    await dashboard()
  })
}

// ---------- FOLDERS ----------
function foldersPanel(panel) {
  if (state.editing) return folderForm(panel, state.editing === 'new' ? {} : state.editing)
  const count = (id) => state.projects.filter((p) => p.folder_id === id).length
  panel.innerHTML = `
    <button class="primary" id="new">+ New folder</button>
    <p><small>Each folder becomes a crate. They are split left and right of the turntable,
      so 2 to 6 folders look best.</small></p>
    ${state.folders.map((f) => `
      <div class="row">
        <span class="dot" style="background:${f.color ? esc(f.color) : 'transparent'}"></span>
        <div class="grow"><strong>${esc(f.name)}</strong><br />
          <small>${count(f.id)} project${count(f.id) === 1 ? '' : 's'}</small></div>
        <span class="pill ${f.published ? '' : 'draft'}">${f.published ? 'Live' : 'Hidden'}</span>
        <button data-edit="${f.id}">Edit</button>
      </div>`).join('') || '<p>No folders yet.</p>'}`
  document.getElementById('new').addEventListener('click', () => { state.editing = 'new'; render() })
  panel.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    state.editing = state.folders.find((f) => f.id === b.dataset.edit)
    render()
  }))
}

function folderForm(panel, f) {
  const isNew = !f.id
  panel.innerHTML = `
    <h2>${isNew ? 'New folder' : 'Edit ' + esc(f.name)}</h2>
    <form id="ff">
      <div class="two">
        <label>Name<input name="name" required value="${esc(f.name)}" /></label>
        <label>Slug<input name="slug" value="${esc(f.slug)}" placeholder="auto from the name" /></label>
      </div>
      <div class="two">
        <label>Crate colour<input type="color" name="color" value="${esc(f.color || '#cccccc')}" /></label>
        <label>Order <small>smaller = further left</small>
          <input type="number" name="sort_order" value="${f.sort_order ?? 0}" /></label>
      </div>
      <label class="check"><input type="checkbox" name="original" ${!f.color ? 'checked' : ''} />
        Keep the crate's original colour (ignore the colour above)</label>
      <label class="check"><input type="checkbox" name="published" ${f.published !== false ? 'checked' : ''} />
        Visible on the site</label>
      <div class="actions">
        <button class="primary" type="submit">Save</button>
        <button type="button" id="cancel">Cancel</button>
        ${isNew ? '' : '<button type="button" class="danger" id="del">Delete</button>'}
      </div>
    </form>`
  const form = document.getElementById('ff')
  document.getElementById('cancel').addEventListener('click', () => { state.editing = null; render() })
  if (!isNew) armDelete(document.getElementById('del'), async () => {
    const { error } = await supabase.from('folders').delete().eq('id', f.id)
    if (error) return toast(friendly(error), true)
    toast('Deleted.')
    state.editing = null
    await dashboard()
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const row = {
      name: fd.get('name').trim(),
      slug: slugify(fd.get('slug') || '') || slugify(fd.get('name')) || 'folder',
      color: fd.get('original') === 'on' ? '' : fd.get('color'),
      sort_order: Number(fd.get('sort_order')) || 0,
      published: fd.get('published') === 'on',
    }
    if (!isNew) row.id = f.id
    const { error } = await supabase.from('folders').upsert(row)
    if (error) return toast(friendly(error), true)
    toast('Saved.')
    state.editing = null
    await dashboard()
  })
}

// ---------- ABOUT AND CONTACT ----------
function sitePanel(panel) {
  const s = state.site || {}
  panel.innerHTML = `
    <h2>About and contact</h2>
    <form id="sf">
      <label>Your name<input name="name" required value="${esc(s.name || 'Ejola Osahontue')}" /></label>
      <label>Tagline<input name="tagline" value="${esc(s.tagline)}" /></label>
      <label>About me<textarea name="bio" rows="6">${esc(s.bio)}</textarea></label>
      <label>Skills <small>separate with commas</small>
        <input name="skills" value="${esc((s.skills || []).join(', '))}" /></label>
      <div class="two">
        <label>Email<input name="email" type="email" value="${esc(s.email)}" /></label>
        <label>WhatsApp number <small>with country code, e.g. 2348012345678</small>
          <input name="whatsapp" value="${esc(s.whatsapp)}" /></label>
      </div>
      <div class="two">
        <label>GitHub link<input name="github_url" type="url" value="${esc(s.github_url)}" /></label>
        <label>itch.io link<input name="itch_url" type="url" value="${esc(s.itch_url)}" /></label>
      </div>
      <div class="actions"><button class="primary" type="submit">Save</button></div>
    </form>`
  document.getElementById('sf').addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const row = {
      id: 1,
      name: fd.get('name').trim(),
      tagline: fd.get('tagline').trim(),
      bio: fd.get('bio').trim(),
      skills: csv(fd.get('skills')),
      email: fd.get('email').trim(),
      whatsapp: fd.get('whatsapp').replace(/\D/g, ''),
      github_url: fd.get('github_url').trim(),
      itch_url: fd.get('itch_url').trim(),
    }
    const { error } = await supabase.from('site').upsert(row)
    if (error) return toast(friendly(error), true)
    toast('Saved.')
    await dashboard()
  })
}

boot()