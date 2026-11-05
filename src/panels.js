// About and Contact panels. Content comes from the `site` row in Supabase
// (edit it in admin.html > "About and contact"). Falls back to the values below.
import { loadSite } from './supabase.js'

const FALLBACK = {
  name: 'Ejola Osahontue',
  tagline: 'I make games and the 3D worlds they live in.',
  bio: '',
  skills: [],
  email: '',
  whatsapp: '',
  github_url: 'https://github.com/EjolaOsahontue',
  itch_url: 'https://ejolaosahontue.itch.io',
}

const drawer = document.getElementById('drawer')
const body = document.getElementById('dBody')
const closeBtn = drawer.querySelector('.x')

let site = null
let siteLoading = null
let lastFocus = null

// ---------- helpers ----------
const safeUrl = (u) => {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''
  } catch (_) { return '' }
}

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  kids.flat().forEach((c) => { if (c) n.append(c) })
  return n
}

async function getSite() {
  if (site) return site
  if (!siteLoading) {
    siteLoading = loadSite().then((data) => {
      site = { ...FALLBACK, ...(data || {}) }
      site.skills = site.skills || []
      return site
    })
  }
  return siteLoading
}

function linkRow(label, url) {
  const href = safeUrl(url)
  if (!href) return null
  return el('a', { class: 'row-link', href, target: '_blank', rel: 'noopener' },
    el('span', { text: label }), el('span', { class: 'arr', text: '↗' }))
}

// ---------- views ----------
function aboutView(s) {
  const paras = String(s.bio || '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)
  return [
    el('p', { class: 'k', text: 'About' }),
    el('h2', { id: 'dTitle', text: s.name }),
    s.tagline ? el('p', { class: 'lead', text: s.tagline }) : null,
    ...paras.map((t) => el('p', { text: t })),
    s.skills.length ? el('div', { class: 'chips' }, s.skills.map((t) => el('span', { text: t }))) : null,
    el('div', { class: 'links' }, linkRow('GitHub', s.github_url), linkRow('itch.io', s.itch_url)),
  ]
}

function contactView(s) {
  const email = String(s.email || '').trim()
  const wa = String(s.whatsapp || '').replace(/\D/g, '')
  const rows = []

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const addr = el('span', { class: 'addr', text: email })
    const copyBtn = el('button', { class: 'mini', type: 'button', text: 'Copy' })
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email)
        copyBtn.textContent = 'Copied'
      } catch (_) {
        const r = document.createRange()
        r.selectNodeContents(addr)
        const sel = getSelection()
        sel.removeAllRanges()
        sel.addRange(r)
        copyBtn.textContent = 'Press Ctrl+C'
      }
      setTimeout(() => (copyBtn.textContent = 'Copy'), 2200)
    })
    rows.push(el('div', { class: 'contact' },
      el('p', { class: 'k', text: 'Email' }),
      el('div', { class: 'addrline' }, addr, copyBtn),
      el('a', { class: 'btn-fill', href: `mailto:${email}`, text: 'Write an email' })))
  }

  if (wa.length >= 7) {
    rows.push(el('div', { class: 'contact' },
      el('p', { class: 'k', text: 'WhatsApp' }),
      el('div', { class: 'addrline' }, el('span', { class: 'addr', text: '+' + wa })),
      el('a', { class: 'btn-fill', href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener', text: 'Message on WhatsApp' })))
  }

  if (!rows.length) {
    rows.push(el('p', { text: 'Contact details are coming soon. In the meantime, find me on GitHub or itch.io below.' }))
  }

  return [
    el('p', { class: 'k', text: 'Contact' }),
    el('h2', { id: 'dTitle', text: "Let's work together" }),
    el('p', { class: 'lead', text: `Have a project, a game idea or a role in mind? Reach ${s.name.split(' ')[0]} directly.` }),
    ...rows,
    el('div', { class: 'links' }, linkRow('GitHub', s.github_url), linkRow('itch.io', s.itch_url)),
  ]
}

// ---------- open / close ----------
async function open(which) {
  lastFocus = document.activeElement
  body.replaceChildren(el('p', { class: 'k', text: 'Loading…' }))
  drawer.classList.add('open')
  drawer.setAttribute('aria-hidden', 'false')
  closeBtn.focus()
  const s = await getSite()
  if (!drawer.classList.contains('open')) return
  body.replaceChildren(...(which === 'contact' ? contactView(s) : aboutView(s)).filter(Boolean))
}

function close() {
  if (!drawer.classList.contains('open')) return
  drawer.classList.remove('open')
  drawer.setAttribute('aria-hidden', 'true')
  if (lastFocus && lastFocus.focus) lastFocus.focus()
}

// delegated, so buttons that are created later (the project page builds its own) work too
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-open]')
  if (b) open(b.dataset.open)
})
drawer.querySelector('.scrim').addEventListener('click', close)
closeBtn.addEventListener('click', close)

// capture phase + stopImmediatePropagation: Esc closes the panel only,
// it does not also leave the project reading view.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) {
    e.stopImmediatePropagation()
    close()
  }
}, true)

// links from other pages: index.html#about or index.html#contact open the panel
if (location.hash === '#about' || location.hash === '#contact') open(location.hash.slice(1))