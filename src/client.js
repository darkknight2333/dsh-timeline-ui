/**
 * dsh-timeline-ui — client half.
 *
 * Two optional enhancements for the DeepSeek Harness Web UI, each with its own switch:
 *   1. sidebar: the conversation list grouped by local calendar day;
 *   2. rail: the per-turn navigation rail moved to the left edge with a fisheye hover.
 *
 * Everything is registered through public-ish extension points: the shipped slots, the
 * standard slot props, and `ctx.locale` / `ctx.uiWorkspace` / `ctx.layout`. The rail is the
 * only exception — the harness keeps it inside the chat package without a slot, so it is
 * found at runtime (see the "rail adapter") instead of being targeted by a baked class hash.
 */

const NS = 'timelineUi'
const PANEL_ID = 'timeline-ui'
const STYLE_MARK = 'dsh-timeline-ui'
const PREF_KEY = 'dsh-timeline-ui/prefs@1'
const RECENT_LIMIT = 15

const RAIL = {
  base: 8,
  peak: 28,
  sigma: 17,
  railWidth: 12,
  frameWidth: 34,
  resetMs: 180,
}

const DICTS = {
  zh: {
    panel: '全部对话',
    panelTitle: '全部对话',
    subtitle: '共 {count} 个对话，按时间倒序',
    search: '搜索对话',
    today: '今天',
    yesterday: '昨天',
    empty: '还没有对话。',
    noMatch: '没有匹配的对话。',
    untitled: '未命名',
    all: '查看全部',
    less: '收起',
    filterArchived: '显示已归档',
    hideArchived: '隐藏已归档',
    more: '更多操作',
    archive: '归档',
    copyId: '复制会话 ID',
    settingsSidebar: '对话列表按日期分组',
    settingsSidebarDesc: '把侧边栏的会话列表按“今天 / 昨天 / 月日”分组并编号。关闭后恢复原生列表。',
    settingsRail: '对话导航条左置 + 鱼眼',
    settingsRailDesc: '把逐轮导航条移到对话区左侧，鼠标经过时按距离形成平滑波峰。',
    on: '开',
    off: '关',
    railMissing: '未在当前 DSH 版本中找到对话导航条，该功能已暂停。',
    legacy: '检测到旧版本地插件仍在运行，请先停用它们。',
  },
  en: {
    panel: 'All conversations',
    panelTitle: 'All conversations',
    subtitle: '{count} conversations, newest first',
    search: 'Search conversations',
    today: 'Today',
    yesterday: 'Yesterday',
    empty: 'No conversations yet.',
    noMatch: 'Nothing matches your search.',
    untitled: 'Untitled',
    all: 'Show all',
    less: 'Show less',
    filterArchived: 'Show archived',
    hideArchived: 'Hide archived',
    more: 'More actions',
    archive: 'Archive',
    copyId: 'Copy session ID',
    settingsSidebar: 'Group the conversation list by day',
    settingsSidebarDesc: 'Group and number the sidebar list by Today / Yesterday / date. Turning it off restores the native list.',
    settingsRail: 'Turn rail on the left with fisheye hover',
    settingsRailDesc: 'Move the per-turn rail to the left edge of the conversation and grow the marks under the pointer.',
    on: 'On',
    off: 'Off',
    railMissing: 'The conversation rail was not found in this DSH version, so that feature is paused.',
    legacy: 'An older local build of this plugin is still active. Disable it first.',
  },
}

function translate(key, vars) {
  const dict = DICTS.zh
  const text = dict[key] || key
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars && vars[name] !== undefined ? String(vars[name]) : match))
}

/* ------------------------------------------------------------------ preferences */

const PREF_DEFAULT = { sidebar: true, rail: true }
let prefs = loadPrefs()
const prefListeners = new Set()

function loadPrefs() {
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    if (!raw) return { ...PREF_DEFAULT }
    const parsed = JSON.parse(raw)
    return {
      sidebar: parsed.sidebar !== false,
      rail: parsed.rail !== false,
    }
  } catch (error) {
    return { ...PREF_DEFAULT }
  }
}

function savePrefs(next) {
  prefs = next
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  } catch (error) {
    /* private mode: keep the in-memory value */
  }
  for (const listener of prefListeners) listener(prefs)
}

function setPref(key, value) {
  savePrefs({ ...prefs, [key]: value !== false })
}

function subscribePrefs(listener) {
  prefListeners.add(listener)
  return () => prefListeners.delete(listener)
}

const railState = {
  value: 'missing',
  listeners: new Set(),
  set(next) {
    if (railState.value === next) return
    railState.value = next
    for (const listener of railState.listeners) listener(next)
  },
  get() {
    return railState.value
  },
  subscribe(listener) {
    railState.listeners.add(listener)
    return () => railState.listeners.delete(listener)
  },
}

function usePrefs() {
  const [snapshot, setSnapshot] = React.useState(prefs)
  React.useEffect(() => {
    setSnapshot(prefs)
    return subscribePrefs(setSnapshot)
  }, [])
  return snapshot
}

/* ------------------------------------------------------------------ dates */

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function dayKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

/** Whole-day distance between two instants, counted by local calendar days (never by 24h). */
function dayDistance(date, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((today - day) / 86400000)
}

function groupLabel(date, now, t) {
  const diff = dayDistance(date, now)
  if (diff === 0) return t('today')
  if (diff === 1) return t('yesterday')
  const month = date.getMonth() + 1
  if (date.getFullYear() === now.getFullYear()) return month + '月' + date.getDate() + '日'
  return date.getFullYear() + '年' + month + '月' + date.getDate() + '日'
}

function groupItems(items, t, nowInput) {
  const now = nowInput instanceof Date ? nowInput : new Date()
  const groups = []
  const index = new Map()
  for (const item of items) {
    const key = item.time ? dayKey(item.time) : 'unknown'
    let group = index.get(key)
    if (!group) {
      group = { key, label: item.time ? groupLabel(item.time, now, t) : t('untitled'), rows: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.rows.push(item)
  }
  return groups
}

/* ------------------------------------------------------------------ session data */

function sessionRows(snapshot) {
  if (!snapshot) return []
  if (Array.isArray(snapshot)) return snapshot
  const byId = snapshot.byId
  const ids = snapshot.ids
  if (byId && Array.isArray(ids)) return ids.map((id) => byId[id]).filter(Boolean)
  if (byId && typeof byId === 'object') return Object.keys(byId).map((key) => byId[key])
  for (const key of ['sessions', 'rows', 'items', 'list', 'records']) {
    if (Array.isArray(snapshot[key])) return snapshot[key]
  }
  return []
}

function canonicalId(value) {
  return String(value).replace(/^session-/, '')
}

function toIdSet(value) {
  if (!value) return null
  let raw = null
  if (typeof Set !== 'undefined' && value instanceof Set) raw = Array.from(value)
  else if (Array.isArray(value)) raw = value
  else if (typeof value === 'object') raw = Object.keys(value)
  if (!raw) return null
  const out = new Set()
  for (const id of raw) {
    out.add(String(id))
    out.add(canonicalId(id))
  }
  return out
}

function archivedValueOf(state) {
  if (!state) return undefined
  if (state.archivedSessionIds !== undefined) return state.archivedSessionIds
  if (state.archived !== undefined) return state.archived
  if (state.archivedIds !== undefined) return state.archivedIds
  if (state.state && state.state.archivedSessionIds !== undefined) return state.state.archivedSessionIds
  return undefined
}

function readRow(row) {
  if (!row || typeof row !== 'object') return null
  const id = row.sessionId || row.id
  if (!id) return null
  const projected = row.projections && row.projections.values ? row.projections.values : null
  const title = row.title || row.displayTitle || (projected && projected.title) || ''
  const raw = row.updatedAt !== undefined ? row.updatedAt : row.lastUpdatedAt
  let time = raw === undefined || raw === null ? null : new Date(raw)
  if (time && isNaN(time.getTime())) time = null
  const retained = row.retainedBy
  return {
    id: String(id),
    title: String(title || ''),
    time,
    blank: row.blank === true,
    running: row.running === true,
    current: !!(retained && typeof retained === 'object' && retained.mainView > 0),
    archived: row.archived === true,
    origin: row.origin || '',
  }
}

function collectItems(snapshot, options) {
  const items = []
  const seen = new Set()
  for (const row of sessionRows(snapshot)) {
    const item = readRow(row)
    if (!item || seen.has(item.id)) continue
    if (item.blank || item.archived) continue
    if (item.origin === 'subagent') continue
    if (options.archived && !options.showArchived && (options.archived.has(item.id) || options.archived.has(canonicalId(item.id)))) continue
    seen.add(item.id)
    items.push(item)
  }
  items.sort((a, b) => (b.time ? b.time.getTime() : 0) - (a.time ? a.time.getTime() : 0))
  return items
}

function useStandard(hook, selector) {
  return typeof hook === 'function' ? hook(selector) : undefined
}

/* ------------------------------------------------------------------ styles */

function sidebarCss() {
  return `
.dtu-root{box-sizing:border-box;display:flex;flex-direction:column;flex:1 1 auto;height:100%;min-height:0;padding:0 8px}
.dtu-head{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:2px;height:28px;padding:0 2px}
.dtu-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dtu-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dtu-icon-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.dtu-searchrow{flex:0 0 auto;padding:0 2px 6px}
.dtu-input{box-sizing:border-box;width:100%;height:30px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none}
.dtu-input::placeholder{color:var(--dsw-alias-label-secondary)}
.dtu-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dtu-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-bottom:4px}
.dtu-group{margin:16px 0 2px;padding:0 8px;font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
.dtu-scroll > .dtu-group:first-child{margin-top:2px}
.dtu-list{list-style:none;margin:0;padding:0}
.dtu-item{position:relative}
.dtu-line{position:relative;display:flex;align-items:center;min-height:30px;border-radius:8px}
.dtu-line:hover,.dtu-line-on{background:var(--dsw-alias-bg-layer-2)}
.dtu-hit{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;padding:4px 0 4px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;overflow:hidden}
.dtu-hit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dtu-gutter{flex:0 0 14px;display:flex;align-items:center;justify-content:center}
.dtu-badge{display:flex;align-items:center;justify-content:center;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:3px;font-size:9.5px;line-height:1;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dtu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}
.dtu-live{flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.dtu-more{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:4px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}
.dtu-line:hover .dtu-more,.dtu-more:focus-visible,.dtu-more-on{opacity:1}
.dtu-menu{position:absolute;right:6px;top:26px;z-index:30;min-width:140px;padding:4px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay)}
.dtu-menuitem{display:block;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dtu-menuitem:hover{background:var(--dsw-alias-bg-layer-2)}
.dtu-all{flex:0 0 auto;display:flex;align-items:center;gap:6px;margin:4px 0 8px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dtu-all:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dtu-empty{padding:28px 8px;font-size:12.5px;color:var(--dsw-alias-label-secondary);text-align:center}
.dtu-panel{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dtu-panel-inner{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 56px}
.dtu-panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px;padding-top:28px}
.dtu-panel-title{flex:0 1 auto;min-width:0;margin:0;font-size:20px;font-weight:500;line-height:28px}
.dtu-panel-sub{margin:0 0 20px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dtu-panel-search{box-sizing:border-box;width:100%;height:36px;margin:0 0 24px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
.dtu-panel-search:focus{border-color:var(--dsw-alias-brand-primary)}
.dtu-panel-group{margin:0 0 22px}
.dtu-panel-grouphead{margin:0 0 4px;padding:6px 0;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
.dtu-panel-row{box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:34px;margin:0 0 1px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dtu-panel-row:hover,.dtu-panel-row-on{background:var(--dsw-alias-bg-layer-2)}
.dtu-panel-rowtime{flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dtu-set{display:flex;align-items:flex-start;gap:16px;padding:12px 0}
.dtu-set-text{flex:1 1 auto;min-width:0}
.dtu-set-title{display:block;font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dtu-set-desc{display:block;margin-top:2px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dtu-set-warn{display:block;margin-top:4px;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-warn-primary)}
.dtu-switch{flex:0 0 auto;position:relative;width:36px;height:20px;margin-top:2px;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background-color .15s ease}
.dtu-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dtu-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
.dtu-switch[aria-checked="true"] .dtu-knob{transform:translateX(16px)}
`
}

/* ------------------------------------------------------------------ icons */

function BadgeIcon(props) {
  const size = props && props.size ? props.size : 16
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
    React.createElement('rect', { x: 2.2, y: 2.8, width: 11.6, height: 10.4, rx: 2 }),
    React.createElement('path', { d: 'M4.6 6h6.8M4.6 8.6h6.8M4.6 11.2h4' }),
  )
}

function SearchIcon() {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true, focusable: false },
    React.createElement('circle', { cx: 7, cy: 7, r: 4.3 }),
    React.createElement('path', { d: 'M10.4 10.4 14 14' }),
  )
}

function FilterIcon() {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true, focusable: false },
    React.createElement('path', { d: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11' }),
    React.createElement('circle', { cx: 6, cy: 4.5, r: 1.5, fill: 'var(--dsw-alias-bg-base)' }),
    React.createElement('circle', { cx: 10.5, cy: 8, r: 1.5, fill: 'var(--dsw-alias-bg-base)' }),
    React.createElement('circle', { cx: 7.5, cy: 11.5, r: 1.5, fill: 'var(--dsw-alias-bg-base)' }),
  )
}

function MoreIcon() {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true, focusable: false },
    React.createElement('circle', { cx: 3.2, cy: 8, r: 1.1 }),
    React.createElement('circle', { cx: 8, cy: 8, r: 1.1 }),
    React.createElement('circle', { cx: 12.8, cy: 8, r: 1.1 }),
  )
}

/* ------------------------------------------------------------------ sidebar list */

function SidebarTimeline(props) {
  const t = typeof props.t === 'function' ? props.t : translate
  const [query, setQuery] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [showArchived, setShowArchived] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [menuFor, setMenuFor] = React.useState(null)

  let snapshot
  let archivedRaw
  let panelId
  try {
    snapshot = useStandard(props.useSessions, (state) => state)
    archivedRaw = useStandard(props.useWorkspaces, (state) => archivedValueOf(state))
    panelId = useStandard(props.usePanelInfo, (info) => (info ? info.activePanelId : null))
  } catch (error) {
    snapshot = null
    archivedRaw = null
    panelId = null
  }

  const items = collectItems(snapshot, { archived: toIdSet(archivedRaw), showArchived })
  const needle = query.trim().toLowerCase()
  const matched = needle ? items.filter((item) => item.title.toLowerCase().indexOf(needle) !== -1) : items
  const limited = needle || expanded ? matched : matched.slice(0, RECENT_LIMIT)
  const groups = groupItems(limited, t)
  const atLimit = !needle && !expanded && matched.length > RECENT_LIMIT

  const open = (sessionId) => {
    if (props.wide === false && typeof props.expandSidebar === 'function') props.expandSidebar()
    if (typeof props.openSession === 'function') props.openSession(sessionId)
    setMenuFor(null)
  }

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const tag = event.target && event.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const digit = Number(event.key)
      if (!digit || digit < 1 || digit > 9) return
      const target = limited[digit - 1]
      if (!target) return
      event.preventDefault()
      open(target.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [limited.map((item) => item.id).join(',')])

  React.useEffect(() => {
    if (menuFor === null) return undefined
    const close = (event) => {
      const node = event.target
      if (node && node.closest && node.closest('.dtu-menu')) return
      setMenuFor(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuFor])

  const orderOf = new Map()
  limited.forEach((item, index) => orderOf.set(item.id, index + 1))

  const body = groups.length
    ? groups.map((group) =>
      React.createElement(
        'div',
        { key: group.key },
        React.createElement('div', { className: 'dtu-group' }, group.label),
        React.createElement(
          'ul',
          { className: 'dtu-list' },
          group.rows.map((item) => {
            const order = orderOf.get(item.id) || 0
            const selected = item.current && !panelId
            const menuOpen = menuFor === item.id
            return React.createElement(
              'li',
              { key: item.id, className: 'dtu-item' },
              React.createElement(
                'div',
                { className: selected ? 'dtu-line dtu-line-on' : 'dtu-line' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dtu-hit',
                    title: (item.title || t('untitled')) + (order <= 9 ? '  (Ctrl+' + order + ')' : ''),
                    'aria-current': selected ? 'true' : undefined,
                    onClick: () => open(item.id),
                  },
                  React.createElement(
                    'span',
                    { className: 'dtu-gutter', 'aria-hidden': true },
                    React.createElement('span', { className: 'dtu-badge' }, String(order)),
                  ),
                  React.createElement('span', { className: 'dtu-label' }, item.title || t('untitled')),
                  item.running ? React.createElement('span', { className: 'dtu-live', 'aria-hidden': true }) : null,
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: menuOpen ? 'dtu-more dtu-more-on' : 'dtu-more',
                    title: t('more'),
                    'aria-label': t('more'),
                    'aria-expanded': menuOpen ? 'true' : 'false',
                    onClick: (event) => {
                      event.stopPropagation()
                      setMenuFor(menuOpen ? null : item.id)
                    },
                  },
                  React.createElement(MoreIcon, null),
                ),
              ),
              menuOpen
                ? React.createElement(
                  'div',
                  { className: 'dtu-menu', role: 'menu' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      className: 'dtu-menuitem',
                      onClick: () => {
                        setMenuFor(null)
                        if (typeof props.copySessionId === 'function') props.copySessionId(item.id)
                      },
                    },
                    t('copyId'),
                  ),
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      className: 'dtu-menuitem',
                      onClick: () => {
                        setMenuFor(null)
                        if (typeof props.archiveSession === 'function') props.archiveSession(item.id)
                      },
                    },
                    t('archive'),
                  ),
                )
                : null,
            )
          }),
        ),
      ),
    )
    : React.createElement('div', { className: 'dtu-empty' }, needle ? t('noMatch') : t('empty'))

  return React.createElement(
    'div',
    { className: 'dtu-root' },
    React.createElement(
      'div',
      { className: 'dtu-head' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: searching ? 'dtu-icon dtu-icon-on' : 'dtu-icon',
          title: t('search'),
          'aria-label': t('search'),
          'aria-pressed': searching ? 'true' : 'false',
          onClick: () => {
            setSearching(!searching)
            if (searching) setQuery('')
          },
        },
        React.createElement(SearchIcon, null),
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: showArchived ? 'dtu-icon dtu-icon-on' : 'dtu-icon',
          title: showArchived ? t('hideArchived') : t('filterArchived'),
          'aria-label': showArchived ? t('hideArchived') : t('filterArchived'),
          'aria-pressed': showArchived ? 'true' : 'false',
          onClick: () => setShowArchived(!showArchived),
        },
        React.createElement(FilterIcon, null),
      ),
    ),
    searching
      ? React.createElement(
        'div',
        { className: 'dtu-searchrow' },
        React.createElement('input', {
          className: 'dtu-input',
          type: 'search',
          autoFocus: true,
          value: query,
          placeholder: t('search'),
          'aria-label': t('search'),
          onChange: (event) => setQuery(event.target.value),
        }),
      )
      : null,
    React.createElement('div', { className: 'dtu-scroll' }, body),
    atLimit || expanded
      ? React.createElement(
        'button',
        {
          type: 'button',
          className: 'dtu-all',
          onClick: () => setExpanded(!expanded),
        },
        t(expanded ? 'less' : 'all'),
      )
      : null,
  )
}

/* ------------------------------------------------------------------ full panel */

function TimelinePanel(props) {
  const t = typeof props.t === 'function' ? props.t : translate
  const [query, setQuery] = React.useState('')

  let snapshot
  let archivedRaw
  try {
    snapshot = useStandard(props.useSessions, (state) => state)
    archivedRaw = useStandard(props.useWorkspaces, (state) => archivedValueOf(state))
  } catch (error) {
    snapshot = null
    archivedRaw = null
  }

  const items = collectItems(snapshot, { archived: toIdSet(archivedRaw), showArchived: false })
  const needle = query.trim().toLowerCase()
  const filtered = needle ? items.filter((item) => item.title.toLowerCase().indexOf(needle) !== -1) : items
  const groups = groupItems(filtered, t)
  const open = (sessionId) => {
    if (typeof props.openSession === 'function') props.openSession(sessionId)
  }

  const list = groups.length
    ? groups.map((group) =>
      React.createElement(
        'section',
        { key: group.key, className: 'dtu-panel-group' },
        React.createElement('h2', { className: 'dtu-panel-grouphead' }, group.label),
        React.createElement(
          'ul',
          { className: 'dtu-list' },
          group.rows.map((item) =>
            React.createElement(
              'li',
              { key: item.id },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: item.current ? 'dtu-panel-row dtu-panel-row-on' : 'dtu-panel-row',
                  title: item.title || t('untitled'),
                  onClick: () => open(item.id),
                },
                React.createElement('span', { className: 'dtu-label' }, item.title || t('untitled')),
                item.running ? React.createElement('span', { className: 'dtu-live', 'aria-hidden': true }) : null,
                React.createElement(
                  'span',
                  { className: 'dtu-panel-rowtime' },
                  item.time ? pad2(item.time.getHours()) + ':' + pad2(item.time.getMinutes()) : '',
                ),
              ),
            ),
          ),
        ),
      ),
    )
    : snapshot && snapshot.phase === 'loading' && items.length === 0
      ? null
      : React.createElement('p', { className: 'dtu-empty' }, needle ? t('noMatch') : t('empty'))

  return React.createElement(
    'div',
    { className: 'dtu-panel' },
    React.createElement(
      'div',
      { className: 'dtu-panel-inner' },
      React.createElement('div', { className: 'dtu-panel-head' }, React.createElement('h1', { className: 'dtu-panel-title' }, t('panelTitle'))),
      React.createElement('p', { className: 'dtu-panel-sub' }, t('subtitle', { count: items.length })),
      React.createElement('input', {
        className: 'dtu-panel-search',
        type: 'search',
        value: query,
        placeholder: t('search'),
        'aria-label': t('search'),
        onChange: (event) => setQuery(event.target.value),
      }),
      list,
    ),
  )
}

/* ------------------------------------------------------------------ rail adapter */

/**
 * The harness renders the per-turn rail inside the chat package without a slot, so it can only
 * be reached through the DOM. Class names are CSS-module hashes and change between builds, so
 * the prefix is DISCOVERED here instead of being written down: a <nav> whose marks are
 * <button data-index> sharing one `<prefix>_mark` token, inside a `<prefix>_slot` parent.
 * If this shape is gone, the feature reports itself unavailable instead of guessing.
 */
function railTokens(el) {
  const name = el && el.className
  return typeof name === 'string' && name ? name.split(/\s+/).filter(Boolean) : []
}

function discoverRail(root) {
  const scope = root || document
  for (const nav of scope.querySelectorAll('nav')) {
    if (!nav.getAttribute('aria-label')) continue
    const frameToken = railTokens(nav).find((token) => token.endsWith('_frame'))
    if (!frameToken) continue
    const prefix = frameToken.slice(0, -'_frame'.length)
    if (!prefix) continue
    const slot = nav.parentElement
    if (!slot || !railTokens(slot).includes(prefix + '_slot')) continue
    // An empty conversation still renders the rail, just without marks, so the host is the
    // structural anchor and the buttons only have to agree when they exist.
    const hasMarksHost = Array.from(nav.querySelectorAll('*')).some((node) => railTokens(node).includes(prefix + '_marks'))
    if (!hasMarksHost) continue
    const marks = Array.from(nav.querySelectorAll('button[data-index]'))
    if (!marks.every((mark) => railTokens(mark).includes(prefix + '_mark'))) continue
    return { nav, slot, prefix }
  }
  return null
}

function railCss(prefix) {
  const p = '.' + prefix
  return [
    p + '_slot ' + p + '_frame{right:auto;left:' + RAIL.railWidth + 'px;width:' + RAIL.frameWidth + 'px}',
    p + '_mark:before{right:auto;left:0;width:var(--dtu-rail-w,' + RAIL.base + 'px);height:2px;border-radius:2px;background:var(--dtu-rail-c,var(--dsw-alias-border-l4));transform:translateY(-50%);transform-origin:0 50%;transition:width .' + RAIL.resetMs + 's ease,background-color .' + RAIL.resetMs + 's ease}',
    p + '_markUnloaded:before,' + p + '_markPreview:before,' + p + '_markActive:before,' + p + '_mark:focus-visible:before{transform:translateY(-50%)}',
    p + '_markActive:before{background:var(--dsw-alias-label-primary)}',
    'html.dtu-fisheye ' + p + '_mark:before{transition:none}',
    p + '_preview{right:auto;left:calc(100% + 10px)}',
  ].join('\n')
}

function railWidthAt(distance) {
  const t = Math.exp(-(distance * distance) / (RAIL.sigma * RAIL.sigma))
  return RAIL.base + (RAIL.peak - RAIL.base) * t
}

function railMixAt(distance) {
  const t = Math.exp(-(distance * distance) / (RAIL.sigma * RAIL.sigma))
  return Math.round(60 * t * t)
}

/**
 * Mount the rail enhancement. Returns a disposer plus a status reader the settings row shows.
 */
function mountRail() {
  const doc = document.documentElement
  let rail = null
  let styleEl = null
  let observer = null
  let raf = 0
  let styled = new Set()

  /**
   * Pointer state. Only this may drive widths: `active` is true strictly while the pointer is
   * inside the rail, so focus, the reading position, a queued frame, or any later scroll can
   * never repaint the marks.
   */
  const hover = { active: false, y: null }

  const clearMarks = () => {
    for (const mark of styled) {
      mark.style.removeProperty('--dtu-rail-w')
      mark.style.removeProperty('--dtu-rail-c')
    }
    styled = new Set()
  }

  /**
   * End the hover. The flag drops first, then a queued frame is cancelled — otherwise a frame
   * scheduled just before the pointer left would repaint from the last known Y and look as if
   * the pointer were still on the rail.
   */
  const stopHover = () => {
    hover.active = false
    hover.y = null
    if (raf !== 0) {
      window.cancelAnimationFrame(raf)
      raf = 0
    }
    doc.classList.remove('dtu-fisheye')
    clearMarks()
  }

  const teardownRail = () => {
    stopHover()
    if (styleEl) {
      styleEl.remove()
      styleEl = null
    }
    rail = null
  }

  const ensure = () => {
    const found = discoverRail()
    if (!found) {
      if (rail) teardownRail()
      railState.set('missing')
      return null
    }
    if (rail && rail.nav === found.nav && styleEl) {
      railState.set('ok')
      return rail
    }
    teardownRail()
    rail = found
    styleEl = document.createElement('style')
    styleEl.dataset.plugin = STYLE_MARK
    styleEl.dataset.pluginCss = STYLE_MARK + '/rail'
    styleEl.textContent = railCss(found.prefix)
    document.head.appendChild(styleEl)
    railState.set('ok')
    return rail
  }

  const paint = () => {
    raf = 0
    // A queued frame is only meaningful while the pointer is still inside the rail.
    if (!hover.active || hover.y === null) return
    if (!rail || !rail.nav.isConnected) {
      stopHover()
      return
    }
    const marks = rail.nav.querySelectorAll('button[data-index]')
    if (marks.length === 0) return
    const next = new Set()
    for (const mark of marks) {
      const rect = mark.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - hover.y)
      mark.style.setProperty('--dtu-rail-w', railWidthAt(distance).toFixed(1) + 'px')
      mark.style.setProperty(
        '--dtu-rail-c',
        'color-mix(in srgb, var(--dsw-alias-label-primary) ' + railMixAt(distance) + '%, var(--dsw-alias-border-l4))',
      )
      next.add(mark)
    }
    for (const mark of styled) {
      if (next.has(mark)) continue
      mark.style.removeProperty('--dtu-rail-w')
      mark.style.removeProperty('--dtu-rail-c')
    }
    styled = next
  }

  const schedule = () => {
    if (raf === 0) raf = window.requestAnimationFrame(paint)
  }

  const railUnder = (event) => {
    const target = event.target
    const nav = target && target.closest ? target.closest('nav') : null
    if (!nav) return null
    const current = rail || ensure()
    return current && nav === current.nav ? current : null
  }

  const onPointerMove = (event) => {
    if (!railUnder(event)) {
      if (hover.active) stopHover()
      return
    }
    hover.active = true
    hover.y = event.clientY
    doc.classList.add('dtu-fisheye')
    schedule()
  }

  const onPointerLeave = () => {
    if (hover.active) stopHover()
  }

  // The rail scrolls its own ladder, so marks can move under a stationary pointer. Repaint only
  // for a pointer that is already inside: body scrolling must never resurrect the fisheye.
  const onScroll = () => {
    if (hover.active) schedule()
  }

  const start = () => {
    ensure()
    let observerRaf = 0
    observer = new MutationObserver(() => {
      if (observerRaf !== 0) return
      observerRaf = window.requestAnimationFrame(() => {
        observerRaf = 0
        if (!rail || !rail.nav.isConnected) ensure()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerleave', onPointerLeave, true)
    window.addEventListener('blur', onPointerLeave)
    document.addEventListener('scroll', onScroll, true)
  }

  start()

  return {
    status: () => (rail ? 'ok' : 'missing'),
    dispose() {
      observer?.disconnect()
      observer = null
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerleave', onPointerLeave, true)
      window.removeEventListener('blur', onPointerLeave)
      document.removeEventListener('scroll', onScroll, true)
      if (raf !== 0) window.cancelAnimationFrame(raf)
      raf = 0
      teardownRail()
      railState.set('missing')
    },
  }
}

/* ------------------------------------------------------------------ settings rows */

function SwitchRow({ label, description, checked, onChange, warning, t }) {
  return React.createElement(
    'div',
    { className: 'dtu-set' },
    React.createElement(
      'div',
      { className: 'dtu-set-text' },
      React.createElement('span', { className: 'dtu-set-title' }, label),
      description ? React.createElement('span', { className: 'dtu-set-desc' }, description) : null,
      warning ? React.createElement('span', { className: 'dtu-set-warn' }, warning) : null,
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        role: 'switch',
        className: 'dtu-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': (checked ? t('on') : t('off')) + ' — ' + label,
        onClick: () => onChange(!checked),
      },
      React.createElement('span', { className: 'dtu-knob', 'aria-hidden': true }),
    ),
  )
}

function SidebarSettingRow(props) {
  const t = typeof props.t === 'function' ? props.t : translate
  const prefsNow = usePrefs()
  return React.createElement(SwitchRow, {
    t,
    label: t('settingsSidebar'),
    description: t('settingsSidebarDesc'),
    checked: prefsNow.sidebar,
    onChange: (value) => setPref('sidebar', value),
  })
}

function RailSettingRow(props) {
  const t = typeof props.t === 'function' ? props.t : translate
  const prefsNow = usePrefs()
  const [status, setStatus] = React.useState(railState.get())
  React.useEffect(() => {
    setStatus(railState.get())
    return railState.subscribe(setStatus)
  }, [])
  const warning = prefsNow.rail && status === 'missing' ? t('railMissing') : undefined
  return React.createElement(SwitchRow, {
    t,
    label: t('settingsRail'),
    description: t('settingsRailDesc'),
    checked: prefsNow.rail,
    onChange: (value) => setPref('rail', value),
    warning,
  })
}

/* ------------------------------------------------------------------ plugin body */

function legacyWarning() {
  const markers = ['@local/dsh-session-timeline', '@local/dsh-rail-left']
  return markers.some((id) => document.querySelector('style[data-plugin="' + id + '"]'))
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'timeline-ui: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = STYLE_MARK
    style.dataset.pluginCss = STYLE_MARK + '/base'
    style.textContent = sidebarCss()
    document.head.appendChild(style)
    return () => style.remove()
  }, 'timeline-ui: base styles')

  if (legacyWarning()) {
    console.warn('[dsh-timeline-ui] ' + translate('legacy'))
  }

  const openSession = (sessionId) => ctx.uiWorkspace.openSession(sessionId)
  const archiveSession = (sessionId) => {
    Promise.resolve(ctx.uiWorkspace.archiveSession(sessionId)).catch(() => {})
  }
  const copySessionId = (sessionId) => {
    try {
      navigator.clipboard.writeText(String(sessionId))
    } catch (error) {
      /* clipboard unavailable */
    }
  }

  // --- sidebar feature (toggleable) ---
  let sidebarDisposer = null
  const syncSidebar = () => {
    if (prefs.sidebar && !sidebarDisposer) {
      sidebarDisposer = ctx.slots.inject('sidebar.workspaces', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces',
            locale: NS,
            // A single slot keeps the first declarer; a lower priority lets this plugin win
            // over the shipped browser instead of rendering beside it.
            priority: -1,
            inject: () => ({ openSession, archiveSession, copySessionId }),
          },
          SidebarTimeline,
        ),
      )
    } else if (!prefs.sidebar && sidebarDisposer) {
      sidebarDisposer()
      sidebarDisposer = null
    }
  }

  // --- rail feature (toggleable) ---
  let railHandle = null
  const syncRail = () => {
    if (prefs.rail && !railHandle) {
      railHandle = mountRail()
    } else if (!prefs.rail && railHandle) {
      railHandle.dispose()
      railHandle = null
    }
  }

  ctx.effect(() => {
    syncSidebar()
    syncRail()
    const stop = subscribePrefs(() => {
      syncSidebar()
      syncRail()
    })
    return () => {
      stop()
      if (sidebarDisposer) {
        sidebarDisposer()
        sidebarDisposer = null
      }
      if (railHandle) {
        railHandle.dispose()
        railHandle = null
      }
    }
  }, 'timeline-ui: features')

  // --- settings rows + optional full panel (always available) ---
  ctx.effect(
    () =>
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          { name: 'settings.general.item', id: 'timeline-ui.sidebar', order: 40, locale: NS },
          SidebarSettingRow,
        ),
      ),
    'timeline-ui: sidebar setting',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          { name: 'settings.general.item', id: 'timeline-ui.rail', order: 41, locale: NS },
          RailSettingRow,
        ),
      ),
    'timeline-ui: rail setting',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ openSession }) }, TimelinePanel),
      ),
    'timeline-ui: panel',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 21, locale: NS, label: () => t('panel') }, BadgeIcon),
      ),
    'timeline-ui: sidebar entry',
  )
}

return {
  inject: ['slots', 'locale', 'uiWorkspace'],
  apply,
}
