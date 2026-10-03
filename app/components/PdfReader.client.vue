<script setup>
import { ref, reactive, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps({
  src: { type: String, required: true },
  title: { type: String, default: 'Brochure' },
  subtitle: { type: String, default: '' }
})

/* ------------------------------- core state ------------------------------- */
const pdfDoc = shallowRef(null)
const loading = ref(true)
const loadError = ref('')
const numPages = ref(0)
const pageSizes = ref([])            // [{ w, h }] at scale 1
const currentPage = ref(1)
const scale = ref(1)
const fitMode = ref('width')         // 'width' | 'page' | 'custom'
const theme = ref('paper')           // 'paper' | 'sepia' | 'night'
const sidebarOpen = ref(false)       // opened on mount for desktop only
const sidebarTab = ref('toc')        // 'toc' | 'pages' | 'search'
const isMobile = ref(false)
const chromeVisible = ref(true)      // kindle-style: tap the page to hide/show the bars
const outline = ref([])              // [{ title, depth, page }]
const isFullscreen = ref(false)

/* --------------------------------- search --------------------------------- */
const searchQuery = ref('')
const searchResults = ref([])        // [{ page, ordinal, snippet }]
const activeResultIdx = ref(-1)
const searching = ref(false)
const pageTexts = shallowRef(null)   // string[] (1-based at idx-1)
const searchInputEl = ref(null)

/* ------------------------------ DOM plumbing ------------------------------ */
const scrollerEl = ref(null)
const stageEl = ref(null)
const pageEls = []
const canvasEls = []
const textEls = []
const thumbEls = []

const renderedScale = reactive({})   // pageNum -> scale it was rendered at
const renderTasks = new Map()        // pageNum -> RenderTask
const renderedThumbs = reactive({})
const visiblePages = new Set()
let pageObserver = null
let thumbObserver = null
let scrollRaf = 0

const THUMB_W = 128
const MIN_SCALE = 0.4
const MAX_SCALE = 4

/* -------------------------------- computed -------------------------------- */
const zoomPct = computed(() => Math.round(scale.value * 100))
const progressPct = computed(() =>
  numPages.value ? Math.round((currentPage.value / numPages.value) * 100) : 0
)
const themeLabel = computed(() =>
  ({ paper: 'Paper', sepia: 'Sepia', night: 'Night' })[theme.value]
)

function slotStyle (i) {
  const s = pageSizes.value[i]
  if (!s) return {}
  return {
    width: Math.round(s.w * scale.value) + 'px',
    height: Math.round(s.h * scale.value) + 'px'
  }
}

function thumbStyle (i) {
  const s = pageSizes.value[i]
  if (!s) return {}
  return { width: THUMB_W + 'px', height: Math.round((s.h / s.w) * THUMB_W) + 'px' }
}

/* --------------------------------- loading -------------------------------- */
async function loadDocument () {
  try {
    const task = pdfjs.getDocument(props.src)
    const doc = await task.promise
    pdfDoc.value = doc
    numPages.value = doc.numPages

    const sizes = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      sizes.push({ w: vp.width, h: vp.height })
    }
    pageSizes.value = sizes
    loading.value = false

    await nextTick()
    applyFit()
    setupObservers()
    loadOutline(doc)
  } catch (err) {
    console.error(err)
    loadError.value = 'The brochure could not be loaded. Please make sure public/brochure.pdf exists.'
    loading.value = false
  }
}

async function loadOutline (doc) {
  try {
    const raw = await doc.getOutline()
    if (!raw || !raw.length) return
    const flat = []
    async function walk (items, depth) {
      for (const it of items) {
        let page = null
        try {
          let dest = it.dest
          if (typeof dest === 'string') dest = await doc.getDestination(dest)
          if (Array.isArray(dest) && dest[0]) {
            page = (await doc.getPageIndex(dest[0])) + 1
          }
        } catch { /* unresolvable dest — keep item without page */ }
        flat.push({ title: it.title, depth, page })
        if (it.items?.length) await walk(it.items, depth + 1)
      }
    }
    await walk(raw, 0)
    outline.value = flat
  } catch { /* no outline available */ }
}

/* ------------------------------- page render ------------------------------ */
function setupObservers () {
  pageObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = Number(e.target.dataset.page)
      if (e.isIntersecting) {
        visiblePages.add(n)
        ensureRendered(n)
      } else {
        visiblePages.delete(n)
      }
    }
  }, { root: scrollerEl.value, rootMargin: '720px 0px' })
  pageEls.forEach((el) => el && pageObserver.observe(el))

  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = Number(e.target.dataset.page)
      if (e.isIntersecting) renderThumb(n)
    }
  }, { rootMargin: '400px 0px' })
  thumbEls.forEach((el) => el && thumbObserver.observe(el))
}

function ensureRendered (n) {
  if (renderedScale[n] === scale.value) return
  renderPage(n)
}

async function renderPage (n) {
  const doc = pdfDoc.value
  const canvas = canvasEls[n - 1]
  const textDiv = textEls[n - 1]
  const slot = pageEls[n - 1]
  if (!doc || !canvas || !slot) return

  const targetScale = scale.value
  renderedScale[n] = targetScale

  try {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: targetScale })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    renderTasks.get(n)?.cancel()

    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = Math.round(viewport.width) + 'px'
    canvas.style.height = Math.round(viewport.height) + 'px'

    const ctx = canvas.getContext('2d')
    const task = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    })
    renderTasks.set(n, task)
    await task.promise
    renderTasks.delete(n)

    // text layer (selection + search highlights)
    if (textDiv) {
      textDiv.innerHTML = ''
      slot.style.setProperty('--scale-factor', String(viewport.scale))
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport
      })
      await textLayer.render()
      applyHighlights(n)
    }
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') {
      renderedScale[n] = 0
      console.error('render page', n, err)
    }
  }
}

async function renderThumb (n) {
  if (renderedThumbs[n]) return
  renderedThumbs[n] = true
  const doc = pdfDoc.value
  const canvas = thumbEls[n - 1]?.querySelector('canvas')
  if (!doc || !canvas) return
  try {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMB_W / base.width })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    }).promise
  } catch (err) {
    renderedThumbs[n] = false
    console.error('render thumb', n, err)
  }
}

/* ----------------------------- zoom / fitting ----------------------------- */
function applyFit () {
  const scroller = scrollerEl.value
  const s = pageSizes.value[Math.max(0, currentPage.value - 1)]
  if (!scroller || !s) return
  const availW = scroller.clientWidth - (isMobile.value ? 18 : 48)
  const availH = scroller.clientHeight - (isMobile.value ? 20 : 40)
  if (fitMode.value === 'width') {
    scale.value = clampScale(availW / s.w)
  } else if (fitMode.value === 'page') {
    scale.value = clampScale(Math.min(availW / s.w, availH / s.h))
  }
}

function clampScale (v) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100))
}

function zoomIn () { fitMode.value = 'custom'; scale.value = clampScale(scale.value * 1.2) }
function zoomOut () { fitMode.value = 'custom'; scale.value = clampScale(scale.value / 1.2) }
function setFit (mode) { fitMode.value = mode; applyFit() }

watch(scale, async () => {
  await nextTick()
  // re-render whatever is on screen at the new scale
  const vis = [...visiblePages]
  vis.forEach((n) => ensureRendered(n))
})

/* ------------------------------- navigation ------------------------------- */
function scrollToPage (n, smooth = false) {
  n = Math.min(numPages.value, Math.max(1, n))
  const el = pageEls[n - 1]
  const scroller = scrollerEl.value
  if (!el || !scroller) return
  scroller.scrollTo({ top: el.offsetTop - 16, behavior: smooth ? 'smooth' : 'auto' })
  currentPage.value = n
}

function nextPage () { scrollToPage(currentPage.value + 1, true) }
function prevPage () { scrollToPage(currentPage.value - 1, true) }

/** navigate from a sidebar panel — on mobile, close the drawer afterwards */
function navigateTo (n) {
  scrollToPage(n)
  if (isMobile.value) sidebarOpen.value = false
}

function onScroll () {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const scroller = scrollerEl.value
    if (!scroller) return
    const marker = scroller.scrollTop + scroller.clientHeight * 0.35
    let page = 1
    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i]
      if (!el) continue
      if (el.offsetTop <= marker) page = i + 1
      else break
    }
    currentPage.value = page
  })
}

function onPageInput (e) {
  const v = parseInt(e.target.value, 10)
  if (!Number.isNaN(v)) scrollToPage(v)
  e.target.value = String(currentPage.value)
}

/* --------------------------------- search --------------------------------- */
async function extractAllText () {
  if (pageTexts.value) return pageTexts.value
  const doc = pdfDoc.value
  const texts = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    texts.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''))
  }
  pageTexts.value = texts
  return texts
}

let searchTimer = 0
watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})

async function runSearch () {
  const q = searchQuery.value.trim()
  activeResultIdx.value = -1
  if (q.length < 2) {
    searchResults.value = []
    refreshHighlights()
    return
  }
  searching.value = true
  try {
    const texts = await extractAllText()
    const needle = q.toLowerCase()
    const results = []
    texts.forEach((text, i) => {
      const hay = text.toLowerCase()
      let idx = 0
      let ordinal = 0
      while ((idx = hay.indexOf(needle, idx)) !== -1 && results.length < 300) {
        const start = Math.max(0, idx - 44)
        const end = Math.min(text.length, idx + needle.length + 44)
        results.push({
          page: i + 1,
          ordinal,
          before: (start > 0 ? '…' : '') + text.slice(start, idx).replace(/\s+/g, ' '),
          match: text.slice(idx, idx + needle.length),
          after: text.slice(idx + needle.length, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '')
        })
        ordinal++
        idx += needle.length
      }
    })
    searchResults.value = results
  } finally {
    searching.value = false
    refreshHighlights()
  }
}

function goToResult (k) {
  if (k < 0 || k >= searchResults.value.length) return
  activeResultIdx.value = k
  const r = searchResults.value[k]
  scrollToPage(r.page)
  if (isMobile.value) sidebarOpen.value = false
  refreshHighlights()
  // center the active highlight once the text layer has it
  setTimeout(() => {
    const mark = textEls[r.page - 1]?.querySelector('mark.is-active')
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 380)
}

function nextResult () {
  if (!searchResults.value.length) return
  goToResult((activeResultIdx.value + 1) % searchResults.value.length)
}
function prevResult () {
  if (!searchResults.value.length) return
  goToResult((activeResultIdx.value - 1 + searchResults.value.length) % searchResults.value.length)
}

function refreshHighlights () {
  for (let n = 1; n <= numPages.value; n++) {
    if (renderedScale[n]) applyHighlights(n)
  }
}

function escapeHtml (s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function applyHighlights (n) {
  const container = textEls[n - 1]
  if (!container) return
  const q = searchQuery.value.trim().toLowerCase()
  const active = activeResultIdx.value >= 0 ? searchResults.value[activeResultIdx.value] : null
  const activeOrdinal = active && active.page === n ? active.ordinal : -1
  const spans = container.querySelectorAll('span')
  let ordinal = 0

  spans.forEach((span) => {
    if (span.dataset.orig === undefined) span.dataset.orig = span.textContent || ''
    const orig = span.dataset.orig
    if (!q || q.length < 2) {
      if (span.innerHTML !== escapeHtml(orig)) span.textContent = orig
      return
    }
    const lower = orig.toLowerCase()
    if (!lower.includes(q)) {
      if (span.querySelector('mark')) span.textContent = orig
      return
    }
    let html = ''
    let pos = 0
    let idx
    while ((idx = lower.indexOf(q, pos)) !== -1) {
      html += escapeHtml(orig.slice(pos, idx))
      const cls = ordinal === activeOrdinal ? 'is-active' : ''
      html += `<mark class="${cls}">${escapeHtml(orig.slice(idx, idx + q.length))}</mark>`
      ordinal++
      pos = idx + q.length
    }
    html += escapeHtml(orig.slice(pos))
    span.innerHTML = html
  })
}

function openSearch () {
  sidebarOpen.value = true
  sidebarTab.value = 'search'
  nextTick(() => searchInputEl.value?.focus())
}

/* ------------------------------ theme / misc ------------------------------ */
function cycleTheme () {
  theme.value = theme.value === 'paper' ? 'sepia' : theme.value === 'sepia' ? 'night' : 'paper'
}

function toggleFullscreen () {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}
function onFsChange () { isFullscreen.value = !!document.fullscreenElement }

/* -------------------------------- keyboard -------------------------------- */
function onKeydown (e) {
  const inInput = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openSearch()
    return
  }
  if (inInput) {
    if (e.key === 'Enter' && e.target === searchInputEl.value) {
      e.shiftKey ? prevResult() : nextResult()
    }
    if (e.key === 'Escape') e.target.blur()
    return
  }
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown': e.preventDefault(); nextPage(); break
    case 'ArrowLeft':
    case 'PageUp': e.preventDefault(); prevPage(); break
    case 'Home': e.preventDefault(); scrollToPage(1); break
    case 'End': e.preventDefault(); scrollToPage(numPages.value); break
    case '+':
    case '=': zoomIn(); break
    case '-': zoomOut(); break
    case '/': e.preventDefault(); openSearch(); break
  }
}

function onResize () {
  if (fitMode.value !== 'custom') applyFit()
}

/* ----------------------- touch gestures (mobile UX) ----------------------- */
let pinch = null      // { d0, scale0, k, focalX, focalY, originX, originY }
let tapStart = null   // { x, y, t }
let tapTimer = 0
let lastTapAt = 0

function touchDist (t) {
  const dx = t[0].clientX - t[1].clientX
  const dy = t[0].clientY - t[1].clientY
  return Math.hypot(dx, dy)
}

function onTouchStart (e) {
  if (e.touches.length === 2) {
    clearTimeout(tapTimer); tapTimer = 0
    tapStart = null
    const sc = scrollerEl.value
    const stage = stageEl.value
    if (!sc || !stage) return
    const rect = sc.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
    pinch = {
      d0: touchDist(e.touches),
      scale0: scale.value,
      k: 1,
      focalX: midX - rect.left,
      focalY: midY - rect.top,
      originX: midX - stageRect.left,
      originY: midY - stageRect.top
    }
    stage.style.transformOrigin = `${pinch.originX}px ${pinch.originY}px`
    stage.style.willChange = 'transform'
  } else if (e.touches.length === 1) {
    tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
  }
}

function onTouchMove (e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault()
    const raw = (touchDist(e.touches) / pinch.d0) * pinch.scale0
    pinch.k = clampScale(raw) / pinch.scale0
    const stage = stageEl.value
    if (stage) stage.style.transform = `scale(${pinch.k})`
    return
  }
  if (tapStart && e.touches.length === 1) {
    const dx = e.touches[0].clientX - tapStart.x
    const dy = e.touches[0].clientY - tapStart.y
    if (Math.hypot(dx, dy) > 10) tapStart = null
  }
}

function onTouchEnd (e) {
  // ----- commit a pinch -----
  if (pinch && e.touches.length < 2) {
    const stage = stageEl.value
    const sc = scrollerEl.value
    if (stage) {
      stage.style.transform = ''
      stage.style.willChange = ''
    }
    const next = clampScale(pinch.scale0 * pinch.k)
    const { focalX, focalY } = pinch
    const prev = pinch.scale0
    pinch = null
    if (sc && Math.abs(next - prev) > 0.01) {
      fitMode.value = 'custom'
      scale.value = next
      nextTick(() => {
        const ratio = next / prev
        sc.scrollTop = (sc.scrollTop + focalY) * ratio - focalY
        sc.scrollLeft = (sc.scrollLeft + focalX) * ratio - focalX
      })
    }
    return
  }

  // ----- tap / double-tap -----
  if (!tapStart || e.touches.length !== 0) { tapStart = null; return }
  const t0 = tapStart
  tapStart = null
  if (Date.now() - t0.t > 320) return
  const touch = e.changedTouches[0]
  if (!touch || Math.hypot(touch.clientX - t0.x, touch.clientY - t0.y) > 10) return
  if (window.getSelection && String(window.getSelection())) return // selecting text

  const now = Date.now()
  if (now - lastTapAt < 300) {
    // double tap → toggle zoom
    clearTimeout(tapTimer); tapTimer = 0
    lastTapAt = 0
    doubleTapZoom(touch.clientX, touch.clientY)
  } else {
    lastTapAt = now
    clearTimeout(tapTimer)
    tapTimer = setTimeout(() => {
      tapTimer = 0
      if (sidebarOpen.value && isMobile.value) sidebarOpen.value = false
      else chromeVisible.value = !chromeVisible.value
    }, 300)
  }
}

function onTouchCancel () {
  if (pinch) {
    const stage = stageEl.value
    if (stage) { stage.style.transform = ''; stage.style.willChange = '' }
    pinch = null
  }
  tapStart = null
}

function doubleTapZoom (clientX, clientY) {
  const sc = scrollerEl.value
  if (!sc) return
  const rect = sc.getBoundingClientRect()
  const focalX = clientX - rect.left
  const focalY = clientY - rect.top
  const prev = scale.value
  if (fitMode.value === 'custom') {
    setFit('width')                     // zoomed in → back to fit width
  } else {
    fitMode.value = 'custom'            // zoom in on the tapped point
    scale.value = clampScale(prev * 1.8)
  }
  nextTick(() => {
    const ratio = scale.value / prev
    sc.scrollTop = (sc.scrollTop + focalY) * ratio - focalY
    sc.scrollLeft = (sc.scrollLeft + focalX) * ratio - focalX
  })
}

function onMediaChange (e) {
  isMobile.value = e.matches
  if (!e.matches) {
    chromeVisible.value = true
    sidebarOpen.value = true
  } else {
    sidebarOpen.value = false
  }
}

/* -------------------------------- lifecycle ------------------------------- */
let mql = null

onMounted(() => {
  mql = window.matchMedia('(max-width: 860px)')
  isMobile.value = mql.matches
  sidebarOpen.value = !mql.matches
  mql.addEventListener('change', onMediaChange)

  loadDocument()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  document.addEventListener('fullscreenchange', onFsChange)

  const sc = scrollerEl.value
  if (sc) {
    sc.addEventListener('touchstart', onTouchStart, { passive: true })
    sc.addEventListener('touchmove', onTouchMove, { passive: false })
    sc.addEventListener('touchend', onTouchEnd, { passive: true })
    sc.addEventListener('touchcancel', onTouchCancel, { passive: true })
  }
})

onBeforeUnmount(() => {
  mql?.removeEventListener('change', onMediaChange)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('fullscreenchange', onFsChange)
  const sc = scrollerEl.value
  if (sc) {
    sc.removeEventListener('touchstart', onTouchStart)
    sc.removeEventListener('touchmove', onTouchMove)
    sc.removeEventListener('touchend', onTouchEnd)
    sc.removeEventListener('touchcancel', onTouchCancel)
  }
  clearTimeout(tapTimer)
  pageObserver?.disconnect()
  thumbObserver?.disconnect()
  renderTasks.forEach((t) => t.cancel())
  pdfDoc.value?.destroy()
})
</script>

<template>
  <div class="reader" :class="`theme-${theme}`">
    <!-- ================= top bar ================= -->
    <header class="topbar" v-show="chromeVisible">
      <div class="topbar-left">
        <button class="icon-btn" :class="{ on: sidebarOpen }" title="Contents (sidebar)" @click="sidebarOpen = !sidebarOpen">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
        </button>
        <div class="title-block">
          <h1>{{ title }}</h1>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
      </div>

      <div class="topbar-center">
        <button class="icon-btn" title="Zoom out (−)" @click="zoomOut">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
        </button>
        <span class="zoom-pct">{{ zoomPct }}%</span>
        <button class="icon-btn" title="Zoom in (+)" @click="zoomIn">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6M11 8v6" /></svg>
        </button>
        <span class="divider" />
        <button class="text-btn" :class="{ on: fitMode === 'width' }" title="Fit width" @click="setFit('width')">Fit width</button>
        <button class="text-btn" :class="{ on: fitMode === 'page' }" title="Fit page" @click="setFit('page')">Fit page</button>
      </div>

      <div class="topbar-right">
        <button class="icon-btn" title="Search (Ctrl+F)" @click="openSearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
        <button class="text-btn theme-btn" :title="`Reading theme: ${themeLabel}`" @click="cycleTheme">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>
          {{ themeLabel }}
        </button>
        <a class="icon-btn" :href="src" download title="Download brochure (PDF)">
          <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /></svg>
        </a>
        <button class="icon-btn" :title="isFullscreen ? 'Exit full screen' : 'Full screen'" @click="toggleFullscreen">
          <svg v-if="!isFullscreen" viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" /></svg>
          <svg v-else viewBox="0 0 24 24"><path d="M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4" /></svg>
        </button>
      </div>
    </header>

    <div class="main">
      <!-- drawer backdrop (mobile) -->
      <div
        v-if="sidebarOpen && isMobile"
        class="backdrop"
        @click="sidebarOpen = false"
      />

      <!-- ================= sidebar ================= -->
      <aside class="sidebar" v-show="sidebarOpen">
        <nav class="tabs">
          <button :class="{ on: sidebarTab === 'toc' }" @click="sidebarTab = 'toc'">Contents</button>
          <button :class="{ on: sidebarTab === 'pages' }" @click="sidebarTab = 'pages'">Pages</button>
          <button :class="{ on: sidebarTab === 'search' }" @click="openSearch()">Search</button>
        </nav>

        <!-- table of contents -->
        <div v-if="sidebarTab === 'toc'" class="panel">
          <p v-if="!outline.length" class="panel-empty">This document has no table of contents.</p>
          <button
            v-for="(it, i) in outline"
            :key="i"
            class="toc-item"
            :class="{ on: it.page === currentPage }"
            :style="{ paddingLeft: 14 + it.depth * 14 + 'px' }"
            @click="it.page && navigateTo(it.page)"
          >
            <span class="toc-title">{{ it.title }}</span>
            <span v-if="it.page" class="toc-page">{{ it.page }}</span>
          </button>
        </div>

        <!-- thumbnails -->
        <div v-else-if="sidebarTab === 'pages'" class="panel thumbs">
          <button
            v-for="n in numPages"
            :key="n"
            class="thumb"
            :class="{ on: n === currentPage }"
            :data-page="n"
            :ref="(el) => (thumbEls[n - 1] = el)"
            @click="navigateTo(n)"
          >
            <div class="thumb-frame" :style="thumbStyle(n - 1)">
              <canvas />
            </div>
            <span class="thumb-num">{{ n }}</span>
          </button>
        </div>

        <!-- search -->
        <div v-else class="panel search-panel">
          <div class="search-box">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              type="search"
              placeholder="Search the brochure…"
              spellcheck="false"
            />
          </div>
          <div class="search-meta" v-if="searchQuery.trim().length >= 2">
            <span v-if="searching">Searching…</span>
            <span v-else>{{ searchResults.length }} result{{ searchResults.length === 1 ? '' : 's' }}</span>
            <span class="search-nav" v-if="searchResults.length">
              <button class="icon-btn sm" title="Previous result (Shift+Enter)" @click="prevResult">
                <svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              <button class="icon-btn sm" title="Next result (Enter)" @click="nextResult">
                <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </span>
          </div>
          <div class="results">
            <button
              v-for="(r, k) in searchResults"
              :key="k"
              class="result"
              :class="{ on: k === activeResultIdx }"
              @click="goToResult(k)"
            >
              <span class="result-page">Page {{ r.page }}</span>
              <span class="result-snippet">{{ r.before }}<mark>{{ r.match }}</mark>{{ r.after }}</span>
            </button>
            <p
              v-if="!searching && searchQuery.trim().length >= 2 && !searchResults.length"
              class="panel-empty"
            >No matches found.</p>
            <p v-if="searchQuery.trim().length < 2" class="panel-empty">
              Type at least two characters to search every page of the brochure.
            </p>
          </div>
        </div>
      </aside>

      <!-- ================= pages ================= -->
      <div ref="scrollerEl" class="scroller" @scroll="onScroll">
        <div v-if="loading" class="status">
          <span class="spinner" />
          <p>Opening the brochure…</p>
        </div>
        <div v-else-if="loadError" class="status error">
          <p>{{ loadError }}</p>
        </div>

        <div v-else class="stage" ref="stageEl">
          <div
            v-for="n in numPages"
            :key="n"
            class="page-slot"
            :data-page="n"
            :style="slotStyle(n - 1)"
            :ref="(el) => (pageEls[n - 1] = el)"
          >
            <canvas :ref="(el) => (canvasEls[n - 1] = el)" />
            <div class="textLayer" :ref="(el) => (textEls[n - 1] = el)" />
          </div>
        </div>
      </div>

      <!-- floating page pill (shown when the bars are tapped away) -->
      <transition name="pill">
        <div v-if="!chromeVisible && numPages" class="page-pill">
          {{ currentPage }} / {{ numPages }} · {{ progressPct }}%
        </div>
      </transition>
    </div>

    <!-- ================= bottom (kindle-style) bar ================= -->
    <footer class="bottombar" v-if="!loading && !loadError" v-show="chromeVisible">
      <button class="icon-btn" title="Previous page (←)" @click="prevPage" :disabled="currentPage <= 1">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      </button>

      <div class="progress">
        <input
          class="page-slider"
          type="range"
          min="1"
          :max="numPages"
          :value="currentPage"
          :style="{ '--p': numPages > 1 ? ((currentPage - 1) / (numPages - 1)) * 100 : 100 }"
          @input="scrollToPage(Number($event.target.value))"
        />
        <div class="progress-meta">
          <span class="page-indicator">
            Page
            <input
              class="page-input"
              type="text"
              inputmode="numeric"
              :value="currentPage"
              @change="onPageInput"
              @keydown.enter="onPageInput"
            />
            of {{ numPages }}
          </span>
          <span class="pct">{{ progressPct }}% through the brochure</span>
        </div>
      </div>

      <button class="icon-btn" title="Next page (→)" @click="nextPage" :disabled="currentPage >= numPages">
        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </footer>
  </div>
</template>

<style scoped>
/* ------------------------------ theme tokens ------------------------------ */
.reader {
  --bg: #e9e4dc;
  --surface: #f7f4ef;
  --surface-2: #efe9e0;
  --ink: #2b2620;
  --muted: #7d7468;
  --line: #d8d0c4;
  --accent: #8a6d3b;
  --accent-soft: rgba(138, 109, 59, 0.14);
  --mark: rgba(240, 195, 80, 0.55);
  --mark-active: rgba(224, 122, 47, 0.85);
  --page-shadow: 0 2px 14px rgba(60, 48, 30, 0.18);
  --canvas-filter: none;

  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
}
@supports (height: 100dvh) {
  .reader { height: 100dvh; } /* track the real visible height on mobile (URL bar) */
}

.reader.theme-sepia {
  --bg: #e7d9bd;
  --surface: #f4ead2;
  --surface-2: #ecdfc2;
  --ink: #4a3a24;
  --muted: #8a7554;
  --line: #d6c5a0;
  --canvas-filter: sepia(0.42) saturate(0.9) brightness(0.99);
}

.reader.theme-night {
  --bg: #15130f;
  --surface: #201d18;
  --surface-2: #27231d;
  --ink: #e6ddcf;
  --muted: #9a9082;
  --line: #3a352c;
  --accent: #c9a35f;
  --accent-soft: rgba(201, 163, 95, 0.16);
  --page-shadow: 0 2px 16px rgba(0, 0, 0, 0.6);
  --canvas-filter: invert(0.93) hue-rotate(180deg) contrast(0.92);
}

/* -------------------------------- top bar -------------------------------- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  z-index: 5;
}
.topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.topbar-center { display: flex; align-items: center; gap: 4px; }
.topbar-right { display: flex; align-items: center; gap: 4px; flex: 1; justify-content: flex-end; }

.title-block { min-width: 0; }
.title-block h1 {
  margin: 0;
  font-family: 'EB Garamond', Georgia, serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title-block p {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-btn, .text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink);
  border-radius: 8px;
  padding: 7px;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.text-btn { padding: 6px 10px; font-size: 12.5px; color: var(--muted); }
.icon-btn:hover, .text-btn:hover { background: var(--accent-soft); }
.icon-btn.on, .text-btn.on { background: var(--accent-soft); border-color: var(--accent); color: var(--ink); }
.icon-btn:disabled { opacity: 0.35; cursor: default; background: transparent; }
.icon-btn svg, .text-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.icon-btn.sm { padding: 4px; }
.icon-btn.sm svg { width: 14px; height: 14px; }
.zoom-pct { min-width: 44px; text-align: center; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.divider { width: 1px; height: 20px; background: var(--line); margin: 0 6px; }

/* --------------------------------- layout --------------------------------- */
.main { flex: 1; display: flex; min-height: 0; position: relative; }

.backdrop {
  position: absolute;
  inset: 0;
  z-index: 9;
  background: rgba(10, 8, 5, 0.45);
  backdrop-filter: blur(1.5px);
}

.page-pill {
  position: absolute;
  left: 50%;
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 8;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 6px 14px;
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  white-space: nowrap;
}
.pill-enter-active, .pill-leave-active { transition: opacity 0.2s, transform 0.2s; }
.pill-enter-from, .pill-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.sidebar {
  width: 300px;
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--line);
  min-height: 0;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1;
  padding: 10px 4px;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tabs button.on { color: var(--ink); border-bottom-color: var(--accent); }

.panel { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
.panel-empty { color: var(--muted); font-size: 12.5px; padding: 12px 10px; line-height: 1.5; }

/* toc */
.toc-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  border-radius: 8px;
  cursor: pointer;
}
.toc-item:hover { background: var(--accent-soft); }
.toc-item.on { background: var(--accent-soft); }
.toc-item.on .toc-title { color: var(--accent); font-weight: 600; }
.toc-title { font-family: 'EB Garamond', Georgia, serif; font-size: 14.5px; }
.toc-page { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }

/* thumbnails */
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
  align-content: start;
  justify-items: center;
  padding: 14px;
}
.thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.thumb-frame {
  background: #fff;
  border: 2px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.12);
}
.thumb.on .thumb-frame { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.thumb-frame canvas { display: block; width: 100%; height: 100%; filter: var(--canvas-filter); }
.thumb-num { font-size: 11px; color: var(--muted); }
.thumb.on .thumb-num { color: var(--accent); font-weight: 600; }

/* search panel */
.search-panel { display: flex; flex-direction: column; padding: 10px; }
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
}
.search-box svg { width: 15px; height: 15px; fill: none; stroke: var(--muted); stroke-width: 1.8; stroke-linecap: round; flex: 0 0 auto; }
.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13.5px;
  outline: none;
  min-width: 0;
}
.search-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 2px 4px;
  color: var(--muted);
  font-size: 12px;
}
.search-nav { display: inline-flex; gap: 2px; }
.results { flex: 1; overflow-y: auto; margin-top: 4px; min-height: 0; }
.result {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.result:hover { background: var(--accent-soft); }
.result.on { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
.result-page { display: block; font-size: 11px; color: var(--accent); font-weight: 600; margin-bottom: 2px; }
.result-snippet { font-size: 12.5px; line-height: 1.45; color: var(--muted); }
.result-snippet mark { background: var(--mark); color: var(--ink); border-radius: 2px; padding: 0 1px; }

/* -------------------------------- scroller -------------------------------- */
.scroller {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 20px 24px 28px;
  scroll-behavior: auto;
  min-width: 0;
  touch-action: pan-x pan-y;        /* we handle pinch-zoom ourselves */
  overscroll-behavior: contain;     /* no pull-to-refresh mid-read */
  -webkit-overflow-scrolling: touch;
}
.stage { min-width: 0; }
.page-slot {
  position: relative;
  margin: 0 auto 18px;
  background: #fff;
  box-shadow: var(--page-shadow);
  border-radius: 2px;
}
.page-slot canvas { display: block; filter: var(--canvas-filter); border-radius: 2px; }

/* pdf.js text layer */
.page-slot :deep(.textLayer) {
  position: absolute;
  inset: 0;
  overflow: hidden;
  line-height: 1;
}
.page-slot :deep(.textLayer span) { color: transparent; position: absolute; white-space: pre; transform-origin: 0 0; cursor: text; }
.page-slot :deep(.textLayer ::selection) { background: rgba(70, 120, 220, 0.35); }
.page-slot :deep(.textLayer mark) {
  background: var(--mark);
  color: transparent;
  border-radius: 2px;
  padding: 0;
}
.page-slot :deep(.textLayer mark.is-active) {
  background: var(--mark-active);
}

/* loading / error */
.status {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--muted);
}
.status.error { color: #a4472f; font-size: 14.5px; text-align: center; padding: 0 30px; }
.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ------------------------------- bottom bar ------------------------------- */
.bottombar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 16px 11px;
  background: var(--surface);
  border-top: 1px solid var(--line);
}
.progress { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }

.page-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) calc((var(--p, 0)) * 1%),
    var(--line) calc((var(--p, 0)) * 1%),
    var(--line) 100%
  );
  outline: none;
  cursor: pointer;
}
.page-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.page-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.page-indicator { display: inline-flex; align-items: center; gap: 5px; }
.page-input {
  width: 34px;
  text-align: center;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: 6px;
  font: inherit;
  font-size: 11.5px;
  padding: 2px 0;
  outline: none;
}
.page-input:focus { border-color: var(--accent); }

/* ------------------------------- responsive ------------------------------- */
@media (max-width: 860px) {
  /* --- top bar: compact, thumb-friendly --- */
  .topbar {
    padding: 6px 8px;
    padding-top: calc(6px + env(safe-area-inset-top, 0px));
    gap: 6px;
  }
  .topbar-center { display: none; }        /* zoom = pinch & double-tap */
  .title-block h1 { font-size: 15.5px; }
  .title-block p { display: none; }
  .theme-btn { font-size: 0; gap: 0; padding: 10px; }

  /* --- bigger touch targets everywhere --- */
  .icon-btn { padding: 10px; }
  .icon-btn svg { width: 19px; height: 19px; }
  .tabs button { padding: 13px 4px; font-size: 13px; }
  .toc-item { padding-top: 12px; padding-bottom: 12px; }
  .toc-title { font-size: 15.5px; }
  .result { padding: 11px 10px; }
  .search-box { padding: 10px 12px; }
  .search-box input { font-size: 15px; }   /* ≥15px stops iOS auto-zoom on focus */

  /* --- sidebar becomes a slide-over drawer --- */
  .sidebar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 10;
    width: min(84vw, 330px);
    flex: none;
    box-shadow: 12px 0 32px rgba(0, 0, 0, 0.3);
    border-right: 1px solid var(--line);
  }
  .thumbs { grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); padding: 12px; }

  /* --- pages: edge-to-edge reading --- */
  .scroller { padding: 10px 8px 16px; }
  .page-slot { margin-bottom: 10px; }

  /* --- bottom bar: compact, safe-area aware --- */
  .bottombar {
    gap: 6px;
    padding: 8px 8px 10px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .page-slider { height: 6px; }
  .page-slider::-webkit-slider-thumb { width: 20px; height: 20px; }
  .page-slider::-moz-range-thumb { width: 18px; height: 18px; }
  .progress-meta { font-size: 11px; }
  .page-input { width: 38px; padding: 4px 0; }
}

/* very narrow phones */
@media (max-width: 380px) {
  .title-block h1 { font-size: 14px; }
  .pct { display: none; }
}

/* coarse pointers: no hover states lingering after taps */
@media (hover: none) {
  .icon-btn:hover, .text-btn:hover, .toc-item:hover, .result:hover, .tabs button:hover {
    background: transparent;
  }
  .icon-btn.on, .text-btn.on, .toc-item.on, .result.on { background: var(--accent-soft); }
}
</style>
