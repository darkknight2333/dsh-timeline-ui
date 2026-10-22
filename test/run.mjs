/**
 * Offline test suite for dsh-timeline-ui.
 *
 * There is no browser in this environment, so the suite loads the BUILT client module into a
 * small fake DOM/React harness and exercises the same code paths the browser would:
 * registration, grouping, filtering, numbering, the rail adapter's discovery, the two
 * switches, and teardown. It cannot prove pixels — see README "验证范围".
 *
 *   node test/run.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok || detail === undefined ? '' : '  -> ' + detail))
}
const section = (name) => console.log('\n=== ' + name + ' ===')

/* ---------------------------------------------------------------- fake DOM */

class FakeElement {
  constructor(tagName, className) {
    this.tagName = tagName.toUpperCase()
    this.className = className || ''
    this.children = []
    this.parentElement = null
    this.attrs = {}
    this.dataset = {}
    this.style = {
      props: new Map(),
      setProperty: (key, value) => this.style.props.set(key, value),
      removeProperty: (key) => this.style.props.delete(key),
    }
    this.isConnected = true
    this.removed = false
    const classes = new Set(String(className || '').split(/\s+/).filter(Boolean))
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    }
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove() {
    this.removed = true
    this.isConnected = false
  }

  getAttribute(name) {
    return this.attrs[name] === undefined ? null : this.attrs[name]
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }

  all() {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  querySelectorAll(selector) {
    const nodes = this.all()
    if (selector === '*') return nodes
    if (selector === 'nav') return nodes.filter((n) => n.tagName === 'NAV')
    if (selector === 'button[data-index]') return nodes.filter((n) => n.tagName === 'BUTTON' && n.attrs['data-index'] !== undefined)
    return []
  }

  closest(selector) {
    let node = this
    while (node) {
      if (selector === 'nav' && node.tagName === 'NAV') return node
      if (selector.startsWith('.') && String(node.className).split(/\s+/).includes(selector.slice(1))) return node
      node = node.parentElement
    }
    return null
  }

  getBoundingClientRect() {
    const index = Number(this.attrs['data-index'] || 0)
    return { top: index * 10, height: 10 }
  }
}

const head = new FakeElement('head')
const body = new FakeElement('body')
const documentElement = new FakeElement('html')
const styleTags = []
const listeners = { document: new Map(), window: new Map() }

const documentStub = {
  head,
  body,
  documentElement,
  createElement(tagName) {
    const el = new FakeElement(tagName)
    if (tagName === 'style') styleTags.push(el)
    return el
  },
  querySelectorAll(selector) {
    return body.querySelectorAll(selector)
  },
  querySelector(selector) {
    const attrMatch = /^style\[data-plugin="([^"]+)"\]$/.exec(selector)
    if (attrMatch) return styleTags.find((tag) => tag.dataset.plugin === attrMatch[1] && !tag.removed) || null
    return null
  },
  addEventListener(type, handler) {
    const set = listeners.document.get(type) || new Set()
    set.add(handler)
    listeners.document.set(type, set)
  },
  removeEventListener(type, handler) {
    listeners.document.get(type)?.delete(handler)
  },
}

const storage = new Map()
const windowStub = {
  document: documentStub,
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
  // The browser hands back a handle and runs the frame later; the harness paints immediately and
  // returns 0 so the pending-frame guard stays open for the next pointer move.
  requestAnimationFrame: (fn) => {
    fn()
    return 0
  },
  cancelAnimationFrame: () => {},
  addEventListener(type, handler) {
    const set = listeners.window.get(type) || new Set()
    set.add(handler)
    listeners.window.set(type, set)
  },
  removeEventListener(type, handler) {
    listeners.window.get(type)?.delete(handler)
  },
}

let observers = 0
class MutationObserverStub {
  constructor(callback) {
    this.callback = callback
    observers += 1
  }
  observe() {}
  disconnect() {
    observers -= 1
  }
}

Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText() {} } }, configurable: true })
globalThis.window = windowStub
globalThis.document = documentStub
globalThis.MutationObserver = MutationObserverStub

const React = {
  createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
    const merged = { ...(props || {}), children: flat }
    if (typeof type === 'function') return type(merged)
    return { type, props: props || {}, children: flat }
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useEffect(fn) {
    fn()
  },
}

/* ---------------------------------------------------------------- load module */

let loaded = null
globalThis.window.__ModuleLoader__ = { load: (mod) => { loaded = mod } }
const built = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', 'MutationObserver', built)(windowStub, documentStub, globalThis.navigator, MutationObserverStub)

section('module')
check('module id is the package name', loaded && loaded.id === 'dsh-timeline-ui', loaded && loaded.id)
const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
check('factory exposes inject + apply', Array.isArray(mod.inject) && typeof mod.apply === 'function')

/* ---------------------------------------------------------------- fake ctx */

const registrations = new Map()
const effects = []
const ctx = {
  locale: {
    register: () => () => {},
    bind: () => (key, vars) => {
      const dict = {
        panel: '全部对话', panelTitle: '全部对话', subtitle: '共 {count} 个对话，按时间倒序', search: '搜索对话',
        today: '今天', yesterday: '昨天', empty: '还没有对话。', noMatch: '没有匹配的对话。', untitled: '未命名',
        all: '查看全部', less: '收起', filterArchived: '显示已归档', hideArchived: '隐藏已归档',
        more: '更多操作', archive: '归档', copyId: '复制会话 ID',
        settingsSidebar: '对话列表按日期分组', settingsSidebarDesc: 'desc', settingsRail: '对话导航条左置 + 鱼眼',
        settingsRailDesc: 'desc', on: '开', off: '关', railMissing: '未找到导航条', legacy: '检测到旧插件',
      }
      return (dict[key] || key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m))
    },
  },
  effect(fn, label) {
    const cleanup = fn()
    effects.push({ label, cleanup })
    return cleanup
  },
  slots: {
    inject(slot, callback) {
      const dispose = callback()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    register(options, Component) {
      const key = options.name + '#' + (options.id || options.key || '')
      const entry = { options, Component }
      registrations.set(key, entry)
      return () => {
        if (registrations.get(key) === entry) registrations.delete(key)
      }
    },
  },
  uiWorkspace: { openSession() {}, archiveSession: () => Promise.resolve() },
}

mod.apply(ctx)
check('registers the sidebar list', registrations.has('sidebar.workspaces#'))
check('registers the rail-independent panel', registrations.has('main#timeline-ui'))
check('registers the sidebar entry', registrations.has('sidebar.panellist#timeline-ui'))
check('registers two settings rows',
  registrations.has('settings.general.item#timeline-ui.sidebar') && registrations.has('settings.general.item#timeline-ui.rail'))
check('injects only public services', JSON.stringify(mod.inject) === JSON.stringify(['slots', 'locale', 'uiWorkspace']), JSON.stringify(mod.inject))
check('base stylesheet injected', styleTags.some((tag) => tag.dataset.pluginCss === 'dsh-timeline-ui/base'))

/* ---------------------------------------------------------------- grouping */

const { SidebarTimeline } = (() => {
  const entry = registrations.get('sidebar.workspaces#')
  return { SidebarTimeline: entry.Component }
})()

const NOW = new Date(2026, 2, 8, 12, 0, 0) // 2026-03-08 12:00 local (US DST spring-forward day)
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const snapshotOf = (rows) => ({ phase: 'ready', ids: rows.map((r) => r.id), byId: Object.fromEntries(rows.map((r) => [r.id, r])) })
const row = (id, title, time, extra) => ({ id, title, updatedAt: time.getTime(), blank: false, running: false, ...extra })

const widgetProps = (snapshot, workspaces) => ({
  t: (key, vars) => key,
  wide: true,
  expandSidebar() {},
  useSessions: (selector) => selector(snapshot),
  useWorkspaces: (selector) => selector(workspaces || { archivedSessionIds: new Set() }),
  usePanelInfo: (selector) => selector({ activePanelId: null }),
  openSession() {},
  archiveSession() {},
  copySessionId() {},
})

const textOf = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { node.forEach((child) => textOf(child, out)); return out }
  if (node.children) node.children.forEach((child) => textOf(child, out))
  return out
}
const findAll = (node, predicate, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((child) => findAll(child, predicate, out)); return out }
  if (predicate(node)) out.push(node)
  if (node.children) node.children.forEach((child) => findAll(child, predicate, out))
  return out
}

section('grouping')
const clock = new Date()
const dayAt = (offset, hour, minute) => {
  const base = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + offset, hour, minute, 0)
  return base
}
const rows = [
  row('a', '今天上午', dayAt(0, Math.max(0, clock.getHours() - 3), 0)),
  row('b', '今天零点后', dayAt(0, 0, 5)),
  row('c', '昨天深夜', dayAt(-1, 23, 55)),
  row('d', '前天', dayAt(-2, 12, 0)),
  row('e', '去年', new Date(clock.getFullYear() - 1, 11, 20, 12, 0)),
]
const tree = SidebarTimeline(widgetProps(snapshotOf(rows)))
const groups = findAll(tree, (n) => n.props && n.props.className === 'dtu-group').map((n) => n.children[0])
check('labels by calendar day', groups[0] === 'today' && groups[1] === 'yesterday', groups.join(' / '))
check('older days get their own group', groups.length === 4, groups.join(' / '))
check('other-year row carries the year', /^(19|20)\d\d年12月20日$/.test(groups[3]), groups[3])
check('numbers every row', findAll(tree, (n) => n.props && n.props.className === 'dtu-badge').map((n) => n.children[0]).join(',') === '1,2,3,4,5')

// The grouping helper runs with a fixed "now" here, so the label logic is deterministic.
const grouping = (() => {
  const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  const grab = (name) => {
    const at = source.indexOf('function ' + name + '(')
    let depth = 0
    let i = source.indexOf('{', at)
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    return source.slice(at, i + 1)
  }
  const factory = new Function(grab('pad2') + grab('dayKey') + grab('dayDistance') + grab('groupLabel') +
    '\nreturn { groupLabel, dayDistance }')
  return factory()
})()

const labelAt = (date, now) => grouping.groupLabel(date, now, (key) => key)
check('24h is not the boundary: 00:05 today vs 23:55 yesterday',
  labelAt(new Date(2026, 2, 7, 23, 55), new Date(2026, 2, 8, 0, 5)) === 'yesterday' &&
  labelAt(new Date(2026, 2, 8, 0, 5), new Date(2026, 2, 8, 0, 5)) === 'today')
check('year boundary: 2025-12-31 vs 2026-01-01',
  labelAt(new Date(2025, 11, 31, 23, 30), new Date(2026, 0, 1, 0, 30)) === 'yesterday')
check('same-year date keeps 月日', /^3月1日$/.test(labelAt(new Date(2026, 2, 1), NOW)), labelAt(new Date(2026, 2, 1), NOW))
check('other-year date carries the year', /^2025年12月20日$/.test(labelAt(new Date(2025, 11, 20), NOW)), labelAt(new Date(2025, 11, 20), NOW))
check('DST spring-forward day is one calendar day',
  grouping.dayDistance(new Date(2026, 2, 7, 12, 0), new Date(2026, 2, 8, 12, 0)) === 1)
check('DST fall-back day is one calendar day',
  grouping.dayDistance(new Date(2026, 10, 1, 0, 30), new Date(2026, 10, 1, 23, 30)) === 0)

section('list behaviour')
const many = Array.from({ length: 20 }, (_, i) => row('s' + i, 's' + i, new Date(2026, 2, 8, 12, 0 - i * 5)))
const archived = new Set(['session-s3'])
const manyTree = SidebarTimeline(widgetProps(snapshotOf(many), { archivedSessionIds: archived }))
const hits = findAll(manyTree, (n) => n.props && n.props.className === 'dtu-hit')
check('caps the list at 15 by default', hits.length === 15, String(hits.length))
check('archived row hidden (prefix-tolerant id)', textOf(manyTree).indexOf('s3') === -1)
check('numbers run 1..15', findAll(manyTree, (n) => n.props && n.props.className === 'dtu-badge').map((n) => n.children[0]).join(',') === Array.from({ length: 15 }, (_, i) => i + 1).join(','))
check('Ctrl hint only on the first nine', hits[0].props.title.indexOf('Ctrl+1') !== -1 && hits[14].props.title.indexOf('Ctrl') === -1)

section('rail adapter')
const prefix = 'test4x'
const slot = new FakeElement('div', prefix + '_slot')
const nav = new FakeElement('nav', prefix + '_frame')
nav.setAttribute('aria-label', 'turn navigation')
slot.appendChild(nav)
const marks = new FakeElement('div', prefix + '_marks')
nav.appendChild(marks)
body.appendChild(slot)
const decoy = new FakeElement('nav', 'other_frame')
decoy.setAttribute('aria-label', 'not the rail')
body.appendChild(decoy)

const pointerMove = [...listeners.document.get('pointermove')].pop()
check('pointer listener installed', typeof pointerMove === 'function')
pointerMove({ target: marks, clientY: 0 })
const railStyle = styleTags.find((tag) => tag.dataset.pluginCss === 'dsh-timeline-ui/rail' && !tag.removed)
check('empty rail (no turns yet) is still discovered', !!railStyle)
for (let i = 0; i < 9; i += 1) {
  const mark = new FakeElement('button', prefix + '_mark')
  mark.setAttribute('data-index', String(i))
  marks.appendChild(mark)
}
pointerMove({ target: marks.children[4], clientY: 45 })
check('discovered rail gets its own stylesheet', !!railStyle)
check('stylesheet uses the discovered prefix', !!railStyle && railStyle.textContent.indexOf('.' + prefix + '_frame') !== -1)
check('stylesheet contains no baked hash', !!railStyle && !/xpvNua/.test(railStyle.textContent))
check('frame is moved to the left', !!railStyle && /_frame\{right:auto;left:12px/.test(railStyle.textContent))
check('marks driven by a width variable', !!railStyle && /width:var\(--dtu-rail-w,8px\)/.test(railStyle.textContent))
check('fisheye class applied on hover', documentElement.classList.contains('dtu-fisheye'))
const widths = marks.children.map((mark) => mark.style.props.get('--dtu-rail-w')).filter(Boolean).map(parseFloat)
check('nearest mark is the widest', widths.length === 9 && widths[4] === Math.max(...widths), widths.join(','))
check('widths fall off symmetrically', widths[0] === widths[8] && widths[3] === widths[5], widths.join(','))
check('far marks stay at the 8px baseline', Math.abs(widths[0] - 8) < 0.2 && Math.abs(widths[8] - 8) < 0.2, widths.join(','))

pointerMove({ target: body, clientY: 45 })
check('leaving the rail clears the inline widths', marks.children.every((mark) => !mark.style.props.has('--dtu-rail-w')))

section('rail hover state machine')
const scroll = [...listeners.document.get('scroll')].pop()
const pointerLeave = [...listeners.document.get('pointerleave')].pop()
const widthList = () => marks.children.map((mark) => mark.style.props.get('--dtu-rail-w') || '-')

pointerMove({ target: marks.children[4], clientY: 45 })
check('hovering paints the fisheye', widthList().some((width) => width !== '-'))

pointerMove({ target: body, clientY: 300 })
check('moving to the body clears every width', widthList().every((width) => width === '-'))
check('moving to the body drops the fisheye class', !documentElement.classList.contains('dtu-fisheye'))

scroll({ target: body })
check('body scroll after leaving cannot repaint', widthList().every((width) => width === '-'))

pointerMove({ target: marks.children[2], clientY: 25 })
const peakWhileHovering = widthList()[2]
scroll({ target: marks })
check('rail scroll while hovering still repaints', widthList()[2] === peakWhileHovering && peakWhileHovering !== '-')

// A frame queued just before the pointer left must not repaint when it finally runs.
const queued = []
const synchronousRaf = windowStub.requestAnimationFrame
windowStub.requestAnimationFrame = (fn) => { queued.push(fn); return 7 }
pointerMove({ target: marks.children[5], clientY: 55 })
windowStub.requestAnimationFrame = synchronousRaf
pointerMove({ target: body, clientY: 300 })
for (const frame of queued) frame()
check('a stale queued frame cannot repaint after leaving', widthList().every((width) => width === '-'))
check('the stale frame leaves the fisheye class off', !documentElement.classList.contains('dtu-fisheye'))

pointerLeave({})
check('pointerleave on an idle rail is harmless', widthList().every((width) => width === '-'))

pointerMove({ target: marks.children[6], clientY: 65 })
check('re-entering the rail paints again', widthList()[6] !== '-' && widthList()[6] !== undefined)
pointerMove({ target: body, clientY: 300 })
check('leaving again clears it', widthList().every((width) => width === '-'))

section('switches')
const sidebarRow = registrations.get('settings.general.item#timeline-ui.sidebar').Component
const railRow = registrations.get('settings.general.item#timeline-ui.rail').Component
const switchOf = (node) => findAll(node, (n) => n.props && n.props.className === 'dtu-switch')[0]
check('sidebar switch starts on', switchOf(sidebarRow({ t: (k) => k })).props['aria-checked'] === 'true')
switchOf(sidebarRow({ t: (k) => k })).props.onClick()
check('turning the sidebar off unregisters the list', !registrations.has('sidebar.workspaces#'))
check('rail switch starts on', switchOf(railRow({ t: (k) => k })).props['aria-checked'] === 'true')
switchOf(railRow({ t: (k) => k })).props.onClick()
check('turning the rail off removes its stylesheet', !styleTags.some((tag) => tag.dataset.pluginCss === 'dsh-timeline-ui/rail' && !tag.removed))

section('teardown')
for (const effect of effects) if (typeof effect.cleanup === 'function') effect.cleanup()
const remainingDocumentListeners = [...listeners.document.values()].reduce((sum, set) => sum + set.size, 0)
const remainingWindowListeners = [...listeners.window.values()].reduce((sum, set) => sum + set.size, 0)
check('rail document listeners removed', ['pointermove', 'pointerleave', 'scroll'].every((type) => (listeners.document.get(type) || new Set()).size === 0))
check('rail window listener removed', (listeners.window.get('blur') || new Set()).size === 0)
check('no mutation observer left', observers === 0, String(observers))
check('base stylesheet removed', !styleTags.some((tag) => tag.dataset.pluginCss === 'dsh-timeline-ui/base' && !tag.removed))

section('portability')
check('built bundle has no absolute paths', !/[A-Za-z]:\\\\/.test(built))
check('built bundle has no link: dependency', !/link:/.test(built))
check('built bundle has no profile name', !/profiles[\\/]/.test(built))
check('built bundle hardcodes no CSS hash', !/xpvNua|_.{5}_(frame|mark)\{/.test(built))

const failed = results.filter((r) => !r.ok).length
console.log('\n' + (failed === 0 ? 'ALL ' + results.length + ' CHECKS PASSED' : failed + ' / ' + results.length + ' CHECK(S) FAILED'))
process.exitCode = failed === 0 ? 0 : 1
