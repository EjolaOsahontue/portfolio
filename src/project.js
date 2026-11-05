import { loadContent, loadSite } from './supabase.js'
import { fallbackProjects } from './fallback.js'
import './panels.js'   // About / Contact drawer, opens right on this page

const app = document.getElementById('app')
const lb = document.getElementById('lb')
const home = import.meta.env.BASE_URL

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

function section(title, content) {
  if (!content || (Array.isArray(content) && !content.length)) return null
  return el('section', { class: 's wrap' }, el('h2', { text: title }), content)
}

// ---------- lightbox ----------
function openLightbox(url, alt) {
  const img = lb.querySelector('img')
  img.src = url
  img.alt = alt
  lb.hidden = false
}
lb.addEventListener('click', () => { lb.hidden = true })
addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.hidden = true })

// ---------- views ----------
function topbar() {
  return el('div', { class: 'top' }, el('div', { class: 'wrap' },
    el('a', { class: 'mono', href: home, text: '← Back to the records' }),
    el('nav', { class: 'nav' },
      el('button', { type: 'button', 'data-open': 'about', text: 'About' }),
      el('button', { type: 'button', class: 'cta', 'data-open': 'contact', text: 'Contact me' }))))
}

function notFound(list) {
  document.title = 'Project not found | Osahontue'
  app.replaceChildren(topbar(), el('div', { class: 'wrap state' },
    el('h1', { text: 'That project was not found' }),
    el('p', { text: 'The link may be old, or the project may be hidden.' }),
    list.length ? el('div', { class: 'more' }, list.map((p) =>
      el('a', { href: `#${encodeURIComponent(p.slug)}` }, el('span', { text: p.name }), el('span', { text: '→' })))) : null,
    el('a', { class: 'btn fill', href: home, text: 'Back to the records' })))
}

function render(p, list, site) {
  document.title = `${p.name} | Osahontue`
  const meta = document.querySelector('meta[name=description]')
  if (meta) meta.setAttribute('content', p.description || `${p.name}, a project by Ejola Osahontue.`)

  const live = safeUrl(p.live)
  const repo = safeUrl(p.repo)
  const cover = safeUrl(p.cover)
  const shots = (p.screenshots || []).map(safeUrl).filter(Boolean)
  const email = String((site && site.email) || '').trim()
  const wa = String((site && site.whatsapp) || '').replace(/\D/g, '')
  const others = list.filter((x) => x.slug !== p.slug)

  const ctaButtons = []
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ctaButtons.push(el('a', { class: 'btn fill', href: `mailto:${email}`, text: 'Email me' }))
  if (wa.length >= 7)
    ctaButtons.push(el('a', { class: 'btn', href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener', text: 'WhatsApp' }))
  ctaButtons.push(el('button', { class: 'btn ghost', type: 'button', 'data-open': 'contact', text: 'All contact options' }))

  app.replaceChildren(...[
    topbar(),
    el('header', { class: 'hero wrap' },
      el('p', { class: 'mono', text: `${p.folder}  ·  ${p.status}` }),
      el('h1', { text: p.name }),
      p.description ? el('p', { class: 'lead', text: p.description }) : null,
      (live || repo) ? el('div', { class: 'actions' },
        live ? el('a', { class: 'btn fill', href: live, target: '_blank', rel: 'noopener', text: 'Open it live ↗' }) : null,
        repo ? el('a', { class: 'btn ghost', href: repo, target: '_blank', rel: 'noopener', text: 'View the code ↗' }) : null) : null),
    cover ? el('div', { class: 'wrap' }, el('img', { class: 'cover', src: cover, alt: `${p.name} cover image` })) : null,
    section('The problem', p.problem ? el('p', { text: p.problem }) : null),
    section('Features', (p.features || []).length
      ? el('ul', { class: 'feat' }, p.features.map((f) => el('li', { text: f }))) : null),
    section('Built with', (p.tech || []).length
      ? el('div', { class: 'chips' }, p.tech.map((t) => el('span', { text: t }))) : null),
    section('Screenshots', shots.length
      ? el('div', { class: 'shots' }, shots.map((u, i) => {
          const b = el('button', { class: 'shot', type: 'button', 'aria-label': `Enlarge screenshot ${i + 1}` },
            el('img', { src: u, alt: `${p.name} screenshot ${i + 1}`, loading: 'lazy' }))
          b.addEventListener('click', () => openLightbox(u, `${p.name} screenshot ${i + 1}`))
          return b
        })) : null),
    section('What I learned', p.learned ? el('p', { text: p.learned }) : null),
    section('More records', others.length
      ? el('div', { class: 'more' }, others.map((o) =>
          el('a', { href: `#${encodeURIComponent(o.slug)}` },
            el('span', { text: o.name }), el('span', { class: 'mono', text: o.folder })))) : null),
    el('div', { class: 'band' }, el('div', { class: 'wrap' },
      el('h2', { text: 'Like what you see?' }),
      el('p', { text: "I'm open to projects, collaborations and roles. Get in touch and let's make something." }),
      el('div', { class: 'actions' }, ctaButtons))),
    el('footer', { class: 'wrap mono', text: `© ${new Date().getFullYear()} Ejola Osahontue` }),
  ].filter(Boolean))   // empty sections are null; replaceChildren would print them as the word "null"
  scrollTo(0, 0)
}

async function main() {
  const [content, site] = await Promise.all([loadContent(), loadSite()])
  const list = content ? content.projects : fallbackProjects
  const slug = decodeURIComponent(location.hash.replace(/^#/, ''))
  const p = list.find((x) => x.slug === slug)
  if (p) render(p, list, site)
  else notFound(list)
}

addEventListener('hashchange', main)
main()