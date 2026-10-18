window.__ModuleLoader__.load({
  id: 'dsh-recycle-bin',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-recycle-bin'
    const PANEL_KEY = 'dsh-recycle-bin'
    const ROUTE = '/dsh-recycle-bin'
    const CHANGE_EVENT = 'dsh-recycle-bin:changed'
    const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,120}$/
    const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const DAY = 24 * 60 * 60 * 1000

    const zh = {
      'meta.title': '回收站',
      'meta.description': '把工作区会话拖入回收站，保留 14 天后自动永久删除，也可随时恢复或立即删除。',
      'nav.title': '回收站',
      'nav.hint': '回收站：把会话拖到这里可以移入回收站',
      'hover.action': '移入回收站',
      'panel.title': '回收站',
      'panel.subtitle': '被移入的会话会在这里保留 14 天，到期后自动永久删除；也可以随时恢复或立即删除。',
      'panel.loading': '正在读取回收站…',
      'panel.empty': '回收站是空的',
      'panel.emptyHint': '把左侧工作区里的会话拖到侧边栏的回收站图标上，或在会话悬停时点「移入回收站」。',
      'panel.dropHint': '松开鼠标，把这个会话放入回收站',
      'panel.workspace': '工作区',
      'panel.trashedAt': '移入于',
      'panel.expiresIn': '剩余',
      'panel.days': '天',
      'panel.expired': '已到期，等待清理',
      'panel.restore': '恢复',
      'panel.delete': '立即删除',
      'panel.confirmDelete': '确认永久删除',
      'panel.cancel': '取消',
      'panel.refresh': '刷新',
      'panel.emptyAll': '清空回收站',
      'panel.confirmEmpty': '确认全部永久删除',
      'panel.retention': '保留 14 天',
      'panel.footer': '删除会一并移除该会话的日志与预览缓存，无法撤销。',
      'drop.label': '松手移入回收站',
      'drop.hint': '回收站 · 保留 14 天，可随时恢复',
      'panel.restoring': '正在恢复…',
      'panel.deleting': '正在删除…',
      'notice.trashed': '已移入回收站',
      'notice.restored': '已恢复到工作区',
      'notice.deleted': '已永久删除',
      'notice.vanished': '会话记录已不存在',
      'notice.missing': '回收站中没有这个会话',
      'notice.active': '该会话正在运行，请先停止它',
      'notice.running': '该会话正在运行，请先停止它再删除',
      'notice.busy': '该会话的日志被其他进程占用，无法删除',
      'notice.notFound': '找不到该会话',
      'notice.failed': '操作失败',
      'notice.dropIgnore': '没有识别到可回收的会话',
      'notice.emptyDone': '已清空回收站',
      'notice.emptyPartial': '部分会话未能删除',
    }

    const en = {
      'meta.title': 'Recycle bin',
      'meta.description': 'Drop workspace sessions into the recycle bin: they stay for 14 days, then are deleted permanently. Restore or delete right away at any time.',
      'nav.title': 'Recycle bin',
      'nav.hint': 'Recycle bin: drop a session here to move it into the bin',
      'hover.action': 'Move to recycle bin',
      'panel.title': 'Recycle bin',
      'panel.subtitle': 'Trashed sessions stay here for 14 days, then are deleted permanently. You can restore or delete them right away.',
      'panel.loading': 'Reading the recycle bin…',
      'panel.empty': 'The recycle bin is empty',
      'panel.emptyHint': 'Drag a session from the workspace onto the recycle-bin icon in the sidebar, or hover a session and choose “Move to recycle bin”.',
      'panel.dropHint': 'Release to move this session into the recycle bin',
      'panel.workspace': 'Workspace',
      'panel.trashedAt': 'Trashed',
      'panel.expiresIn': 'expires in',
      'panel.days': 'd',
      'panel.expired': 'expired, waiting for cleanup',
      'panel.restore': 'Restore',
      'panel.delete': 'Delete now',
      'panel.confirmDelete': 'Delete permanently',
      'panel.cancel': 'Cancel',
      'panel.refresh': 'Refresh',
      'panel.emptyAll': 'Empty recycle bin',
      'panel.confirmEmpty': 'Delete all permanently',
      'panel.retention': 'Kept for 14 days',
      'panel.footer': 'Deleting removes the session log and its preview cache. This cannot be undone.',
      'drop.label': 'Release to move to the recycle bin',
      'drop.hint': 'Recycle bin · kept 14 days, restorable',
      'panel.restoring': 'Restoring…',
      'panel.deleting': 'Deleting…',
      'notice.trashed': 'Moved to the recycle bin',
      'notice.restored': 'Restored to the workspace',
      'notice.deleted': 'Deleted permanently',
      'notice.vanished': 'This session no longer exists',
      'notice.missing': 'No such session in the recycle bin',
      'notice.active': 'This session is still running; stop it first',
      'notice.running': 'This session is still running; stop it before deleting',
      'notice.busy': 'Another process holds this session log, so it cannot be deleted',
      'notice.notFound': 'Session not found',
      'notice.failed': 'The operation failed',
      'notice.dropIgnore': 'This drag did not carry a session',
      'notice.emptyDone': 'Recycle bin emptied',
      'notice.emptyPartial': 'Some sessions could not be deleted',
    }

    function request(method, action, body) {
      const init = { method, credentials: 'same-origin', headers: { 'x-dsh-recycle-bin': '1' } }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(ROUTE + '/' + action, init).then(
        (response) => response.json().then(
          (data) => data,
          () => ({ ok: false, code: 'bad-response', message: 'HTTP ' + response.status }),
        ),
        () => ({ ok: false, code: 'network', message: '无法连接到宿主进程，请确认 DSH 仍在运行' }),
      )
    }

    function notifyChanged() {
      try {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
      } catch {
        // non-fatal
      }
    }

    // The session row's own drag payload format is owned by the sidebar, so the
    // zone keeps a fallback captured at dragstart: whatever dataTransfer holds,
    // a UUID found in the dragged element's data attributes still identifies it.
    let activeDragSession = ''

    // A drop on the 16px sidebar entry has no room for text, so failures from
    // that path surface through the floating banner instead of a red flash only.
    const alertListeners = new Set()
    let alertText = ''
    let alertTimer = 0

    function subscribeAlert(listener) {
      alertListeners.add(listener)
      return () => alertListeners.delete(listener)
    }

    function pushAlert(text) {
      alertText = text || ''
      alertListeners.forEach((listener) => listener(alertText))
      clearTimeout(alertTimer)
      alertTimer = setTimeout(() => {
        alertText = ''
        alertListeners.forEach((listener) => listener(''))
      }, 6000)
    }

    function failureText(result, t) {
      const code = result && result.code
      if (code === 'active') return t('notice.active')
      if (code === 'running') return t('notice.running')
      if (code === 'busy') return t('notice.busy')
      if (code === 'not-found' || code === 'missing') return t('notice.notFound')
      return (result && result.message) || t('notice.failed')
    }

    function sessionIdFromElement(target) {
      let el = target && target.nodeType === 1 ? target : null
      let depth = 0
      while (el && depth < 8) {
        const attrs = []
        try {
          if (el.getAttribute) {
            attrs.push(el.getAttribute('data-session-id'), el.getAttribute('data-id'))
          }
          if (el.dataset) for (const key of Object.keys(el.dataset)) attrs.push(el.dataset[key])
          attrs.push(el.id)
        } catch {
          // ignore an element that refuses attribute reads
        }
        for (const raw of attrs) {
          if (typeof raw !== 'string' || raw === '') continue
          const hit = raw.match(UUID_PATTERN)
          if (hit) return hit[0]
        }
        el = el.parentElement
        depth += 1
      }
      return ''
    }

    function rememberDragStart(event) {
      activeDragSession = ''
      const target = event.target
      const transfer = event.dataTransfer
      const direct = extractSessionId(transfer) || sessionIdFromElement(target)
      if (direct) {
        activeDragSession = direct
        return
      }
      // The source row installs its payload in its own dragstart handler, which
      // runs after this capture listener; a task later the element still exists.
      setTimeout(() => {
        if (activeDragSession) return
        activeDragSession = sessionIdFromElement(target)
      }, 0)
    }

    // A drop target may only publish a dropEffect the source's effectAllowed
    // accepts; forcing 'move' on a copy-only source makes the browser show the
    // no-drop cursor even though dragover was prevented.
    function acceptDragEffect(dataTransfer) {
      if (!dataTransfer) return
      try {
        const allowed = String(dataTransfer.effectAllowed || '')
        if (allowed === 'none') return
        if (allowed === 'copy' || allowed === 'copyLink') dataTransfer.dropEffect = 'copy'
        else if (allowed === 'link') dataTransfer.dropEffect = 'link'
        else dataTransfer.dropEffect = 'move'
      } catch {
        // some transfers are read-only; leaving the default is fine
      }
    }

    function sessionIdFromValue(raw) {
      const trimmed = raw.trim()
      if (!trimmed) return ''
      const uuid = trimmed.match(UUID_PATTERN)
      if (uuid) return uuid[0]
      if (ID_PATTERN.test(trimmed) && !/\s/.test(trimmed)) return trimmed
      try {
        const parsed = JSON.parse(trimmed)
        const candidate = parsed && (parsed.sessionId || parsed.session || parsed.id)
        if (typeof candidate !== 'string') return ''
        const value = candidate.trim()
        const nested = value.match(UUID_PATTERN)
        if (nested) return nested[0]
        if (ID_PATTERN.test(value) && !/\s/.test(value)) return value
      } catch {
        // plain text, already covered above
      }
      return ''
    }

    function extractSessionId(dataTransfer) {
      if (!dataTransfer) return ''
      let types = []
      try {
        const list = dataTransfer.types
        types = list ? Array.from(list) : []
      } catch {
        return ''
      }
      const ranked = []
      for (const type of types) {
        let raw = ''
        try {
          raw = dataTransfer.getData(type)
        } catch {
          raw = ''
        }
        if (!raw) continue
        const value = sessionIdFromValue(raw)
        if (!value) continue
        const strong = UUID_PATTERN.test(value) ? 2 : 0
        const custom = type !== 'text/plain' && type !== 'text/uri-list' ? 2 : 0
        ranked.push({ value, score: strong + custom })
      }
      ranked.sort((a, b) => b.score - a.score)
      return ranked.length > 0 ? ranked[0].value : ''
    }

    function dragCarriesSession(event) {
      try {
        const types = event.dataTransfer && event.dataTransfer.types
        if (types) {
          for (let index = 0; index < types.length; index += 1) {
            if (String(types[index]) === 'Files') return false
          }
        }
      } catch {
        return activeDragSession !== ''
      }
      return true
    }

    function TrashGlyph(props) {
      const size = props.size
      const color = props.flash === 'done'
        ? 'var(--dsw-alias-state-success-primary)'
        : props.flash === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : props.active
            ? 'var(--dsw-alias-brand-primary)'
            : 'currentColor'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', { d: 'M4.6 7.2h14.8' }),
        h('path', { d: 'M9.4 7.2V5.5c0-.83.67-1.5 1.5-1.5h2.2c.83 0 1.5.67 1.5 1.5v1.7' }),
        h('path', { d: 'M6.5 7.2l.78 11.05c.06.9.81 1.55 1.7 1.55h5.98c.9 0 1.64-.65 1.7-1.55L17.5 7.2' }),
        h('path', { d: 'M10.3 10.6v5.7' }),
        h('path', { d: 'M13.7 10.6v5.7' }),
      )
    }

    function buttonStyle(tone) {
      const base = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        padding: '4px 10px',
        cursor: 'pointer',
      }
      if (tone === 'danger') {
        return Object.assign({}, base, {
          borderColor: 'var(--dsw-alias-state-error-primary)',
          color: 'var(--dsw-alias-state-error-primary)',
        })
      }
      if (tone === 'primary') {
        return Object.assign({}, base, {
          borderColor: 'var(--dsw-alias-brand-primary)',
          color: 'var(--dsw-alias-brand-primary)',
        })
      }
      if (tone === 'ghost') {
        return Object.assign({}, base, {
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary)',
        })
      }
      return base
    }

    function makePanelIcon(t) {
      return function RecycleBinPanelIcon(props) {
        const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 18
        const [over, setOver] = useState(false)
        const [flash, setFlash] = useState('')
        const nodeRef = useRef(null)
        const overRef = useRef(false)
        const timer = useRef(0)
        useEffect(() => () => clearTimeout(timer.current), [])

        const showOver = (value) => {
          if (overRef.current === value) return
          overRef.current = value
          setOver(value)
        }
        const submit = (sessionId) => {
          showOver(false)
          request('POST', 'trash', { sessionId }).then((result) => {
            setFlash(result && result.ok ? 'done' : 'error')
            if (!result || !result.ok) pushAlert(failureText(result, t))
            notifyChanged()
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setFlash(''), 1800)
          })
        }

        useEffect(() => {
          const node = nodeRef.current
          if (!node) return undefined
          // Hit test by geometry first: the sidebar renders the entry's button
          // around this cell, and the exact wrapper markup is not ours to depend on.
          const insideIcon = (event) => {
            if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return false
            let rect
            try {
              rect = node.getBoundingClientRect()
            } catch {
              return false
            }
            const pad = 4
            return event.clientX >= rect.left - pad && event.clientX <= rect.right + pad
              && event.clientY >= rect.top - pad && event.clientY <= rect.bottom + pad
          }
          const owns = (event) => {
            if (insideIcon(event)) return true
            const target = event.target
            if (!target) return false
            if (node.contains(target)) return true
            if (typeof target.closest !== 'function') return false
            let owner = target.closest('button, [role="button"]')
            let depth = 0
            while (owner && depth < 4) {
              if (owner.contains(node)) return true
              owner = owner.parentElement && typeof owner.parentElement.closest === 'function'
                ? owner.parentElement.closest('button, [role="button"]')
                : null
              depth += 1
            }
            return false
          }
          const onAnyOver = (event) => {
            if (!dragCarriesSession(event) || !owns(event)) {
              showOver(false)
              return
            }
            event.preventDefault()
            event.stopPropagation()
            acceptDragEffect(event.dataTransfer)
            showOver(true)
          }
          const onAnyDrop = (event) => {
            if (!owns(event)) return
            const sessionId = extractSessionId(event.dataTransfer) || activeDragSession
            if (!sessionId) {
              showOver(false)
              return
            }
            event.preventDefault()
            event.stopPropagation()
            activeDragSession = ''
            submit(sessionId)
          }
          const onAnyEnd = () => {
            activeDragSession = ''
            showOver(false)
          }
          window.addEventListener('dragover', onAnyOver, true)
          window.addEventListener('drop', onAnyDrop, true)
          window.addEventListener('dragend', onAnyEnd, true)
          return () => {
            window.removeEventListener('dragover', onAnyOver, true)
            window.removeEventListener('drop', onAnyDrop, true)
            window.removeEventListener('dragend', onAnyEnd, true)
          }
        }, [])

        const onDragOver = (event) => {
          if (!dragCarriesSession(event)) return
          event.preventDefault()
          event.stopPropagation()
          acceptDragEffect(event.dataTransfer)
          showOver(true)
        }
        const onDrop = (event) => {
          const sessionId = extractSessionId(event.dataTransfer) || activeDragSession
          if (!sessionId) {
            showOver(false)
            return
          }
          event.preventDefault()
          event.stopPropagation()
          activeDragSession = ''
          submit(sessionId)
        }
        return h('span', {
          ref: nodeRef,
          role: 'img',
          'aria-label': t('nav.title'),
          title: t('nav.hint'),
          onDragEnter: onDragOver,
          onDragOver,
          onDragLeave: () => showOver(false),
          onDrop,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            padding: 6,
            margin: -6,
            boxSizing: 'content-box',
            borderRadius: 8,
            color: over ? 'var(--dsw-alias-brand-primary)' : 'inherit',
            background: over ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            outline: over ? '1px dashed var(--dsw-alias-brand-primary)' : 'none',
            transform: over ? 'scale(1.08)' : 'none',
            transition: 'transform 120ms ease, background 120ms ease',
          },
        }, h(TrashGlyph, { size, active: Boolean(props?.active), flash }))
      }
    }

    function makeHoverAction(t) {
      return function TrashHoverAction(props) {
        const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
        const [phase, setPhase] = useState('idle')
        const timer = useRef(0)
        useEffect(() => () => clearTimeout(timer.current), [])
        if (!sessionId) return null
        const label = phase === 'busy'
          ? t('panel.loading')
          : phase === 'done'
            ? t('notice.trashed')
            : phase === 'error'
              ? t('notice.failed')
              : t('hover.action')
        const onClick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (phase === 'busy' || phase === 'done') return
          setPhase('busy')
          request('POST', 'trash', { sessionId }).then((result) => {
            if (result && result.ok) {
              setPhase('done')
              notifyChanged()
              return
            }
            setPhase('error')
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setPhase('idle'), 2200)
          })
        }
        return h('button', {
          type: 'button',
          onClick,
          title: t('hover.action'),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: phase === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
            font: 'inherit',
            fontSize: 12,
            lineHeight: '16px',
            padding: '2px 6px',
            cursor: 'pointer',
          },
        },
          h('svg', {
            width: 12,
            height: 12,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
            h('path', { d: 'M4.6 7.2h14.8' }),
            h('path', { d: 'M6.5 7.2l.78 11.05c.06.9.81 1.55 1.7 1.55h5.98c.9 0 1.64-.65 1.7-1.55L17.5 7.2' }),
            h('path', { d: 'M9.4 7.2V5.5c0-.83.67-1.5 1.5-1.5h2.2c.83 0 1.5.67 1.5 1.5v1.7' }),
          ),
          h('span', null, label),
        )
      }
    }

    function makePanel(t) {
      return function RecycleBinPanel() {
        const [items, setItems] = useState([])
        const [loading, setLoading] = useState(true)
        const [notice, setNotice] = useState('')
        const [failed, setFailed] = useState('')
        const [pending, setPending] = useState('')
        const [pendingAction, setPendingAction] = useState('')
        const [confirm, setConfirm] = useState('')
        const [emptyConfirm, setEmptyConfirm] = useState(false)
        const [dragging, setDragging] = useState(false)
        const confirmTimer = useRef(0)

        const load = useCallback(() => {
          return request('GET', 'list').then((result) => {
            if (result && result.ok && Array.isArray(result.items)) {
              setItems(result.items)
              setFailed('')
            } else if (result && result.message) {
              setFailed(String(result.message))
            }
            setLoading(false)
          }, () => {
            setLoading(false)
            setFailed(t('notice.failed'))
          })
        }, [])

        useEffect(() => {
          load()
          const onChange = () => load()
          window.addEventListener(CHANGE_EVENT, onChange)
          const interval = setInterval(load, 60000)
          return () => {
            window.removeEventListener(CHANGE_EVENT, onChange)
            clearInterval(interval)
            clearTimeout(confirmTimer.current)
          }
        }, [load])

        const armConfirm = (sessionId) => {
          setConfirm(sessionId)
          clearTimeout(confirmTimer.current)
          confirmTimer.current = setTimeout(() => setConfirm(''), 5000)
        }

        const act = (sessionId, action) => {
          setPending(sessionId)
          setPendingAction(action)
          setFailed('')
          setNotice('')
          request('POST', action, { sessionId }).then((result) => {
            setPending('')
            setPendingAction('')
            setConfirm('')
            if (result && result.ok) {
              setNotice(action === 'restore' ? t('notice.restored') : t('notice.deleted'))
            } else {
              const code = result && result.code
              setFailed(
                code === 'busy' ? t('notice.busy')
                  : code === 'missing' ? t('notice.missing')
                    : code === 'vanished' ? t('notice.vanished')
                      : (result && result.message) || t('notice.failed'),
              )
            }
            notifyChanged()
            load()
          })
        }

        const emptyAll = () => {
          if (!emptyConfirm) {
            setEmptyConfirm(true)
            clearTimeout(confirmTimer.current)
            confirmTimer.current = setTimeout(() => setEmptyConfirm(false), 5000)
            return
          }
          setEmptyConfirm(false)
          setPending('*')
          setPendingAction('empty')
          request('POST', 'empty', {}).then((result) => {
            setPending('')
            setPendingAction('')
            if (result && result.ok) setNotice(t('notice.emptyDone'))
            else if (result && result.removed > 0) setFailed(t('notice.emptyPartial'))
            else setFailed((result && result.message) || t('notice.failed'))
            notifyChanged()
            load()
          })
        }

        const onDrop = (event) => {
          const sessionId = extractSessionId(event.dataTransfer) || activeDragSession
          setDragging(false)
          if (!sessionId) return
          event.preventDefault()
          event.stopPropagation()
          acceptDragEffect(event.dataTransfer)
          activeDragSession = ''
          setPending(sessionId)
          setPendingAction('trash')
          request('POST', 'trash', { sessionId }).then((result) => {
            setPending('')
            setPendingAction('')
            if (result && result.ok) setNotice(t('notice.trashed'))
            else setFailed(
              result && result.code === 'active' ? t('notice.active')
                : (result && result.message) || t('notice.failed'),
            )
            notifyChanged()
            load()
          })
        }

        const dropZoneProps = {
          onDragEnter: (event) => {
            if (!dragCarriesSession(event)) return
            event.preventDefault()
            acceptDragEffect(event.dataTransfer)
            setDragging(true)
          },
          onDragOver: (event) => {
            if (!dragCarriesSession(event)) return
            event.preventDefault()
            acceptDragEffect(event.dataTransfer)
            setDragging(true)
          },
          onDragLeave: (event) => {
            if (event.currentTarget === event.target) setDragging(false)
          },
          onDrop,
        }

        const rows = items.map((item) => {
          const busy = pending === item.sessionId || pending === '*'
          const arming = confirm === item.sessionId
          const title = item.title || item.sessionId.slice(0, 8)
          const metaParts = []
          if (item.workspaceTitle) metaParts.push(item.workspaceTitle)
          if (item.daysLeft <= 0) metaParts.push(t('panel.expired'))
          else metaParts.push(t('panel.expiresIn') + ' ' + String(item.daysLeft) + ' ' + t('panel.days'))
          return h('div', {
            key: item.sessionId,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 10,
              background: 'var(--dsw-alias-bg-layer-1)',
              opacity: busy ? 0.6 : 1,
            },
          },
            h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              h('div', {
                title,
                style: {
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--dsw-alias-label-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }, title),
              h('div', {
                style: {
                  marginTop: 2,
                  fontSize: 11,
                  color: item.daysLeft <= 2 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }, metaParts.join(' · ')),
            ),
            h('div', { style: { display: 'flex', gap: 6, flex: '0 0 auto' } },
              h('button', {
                type: 'button',
                disabled: busy,
                onClick: () => act(item.sessionId, 'restore'),
                style: buttonStyle('primary'),
              }, busy && pending === item.sessionId && pendingAction === 'restore' ? t('panel.restoring') : t('panel.restore')),
              h('button', {
                type: 'button',
                disabled: busy,
                onClick: () => (arming ? act(item.sessionId, 'delete') : armConfirm(item.sessionId)),
                style: buttonStyle('danger'),
              }, busy && pending === item.sessionId && pendingAction === 'delete'
                ? t('panel.deleting')
                : arming ? t('panel.confirmDelete') : t('panel.delete')),
            ),
          )
        })

        const body = loading
          ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, t('panel.loading'))
          : rows.length === 0
            ? h('div', {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '48px 16px',
                border: '1px dashed var(--dsw-alias-border-l1)',
                borderRadius: 12,
                color: 'var(--dsw-alias-label-secondary)',
                textAlign: 'center',
              },
            },
              h(TrashGlyph, { size: 34, active: false, flash: '' }),
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('panel.empty')),
              h('div', { style: { fontSize: 12, maxWidth: 420, lineHeight: '18px' } }, t('panel.emptyHint')),
            )
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, rows)

        return h('div', Object.assign({
          style: {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'auto',
            padding: '24px 28px',
            gap: 14,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          },
        }, dropZoneProps),
          dragging
            ? h('div', {
              style: {
                position: 'absolute',
                inset: 8,
                border: '2px dashed var(--dsw-alias-brand-primary)',
                borderRadius: 14,
                background: 'var(--dsw-alias-bg-layer-2)',
                opacity: 0.94,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: 'var(--dsw-alias-brand-primary)',
                pointerEvents: 'none',
                zIndex: 2,
              },
            }, t('panel.dropHint'))
            : null,
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
            h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: '22px' } }, t('panel.title')),
              h('p', { style: { margin: '4px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, t('panel.subtitle')),
            ),
            h('div', { style: { display: 'flex', gap: 6, flex: '0 0 auto' } },
              rows.length > 0
                ? h('button', {
                  type: 'button',
                  disabled: pending !== '' && pending !== null,
                  onClick: emptyAll,
                  style: emptyConfirm ? buttonStyle('danger') : buttonStyle(),
                }, emptyConfirm ? t('panel.confirmEmpty') : t('panel.emptyAll'))
                : null,
              h('button', { type: 'button', onClick: () => load(), style: buttonStyle('ghost') }, t('panel.refresh')),
            ),
          ),
          notice
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, notice)
            : null,
          failed
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, failed)
            : null,
          h('div', { style: { flex: '1 1 auto', minHeight: 0 } }, body),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: '16px' } }, t('panel.footer')),
        )
      }
    }

    function makeDropBanner(t) {
      return function RecycleBinDropBanner() {
        const [visible, setVisible] = useState(false)
        const [over, setOver] = useState(false)
        const [flash, setFlash] = useState('')
        const [alert, setAlert] = useState(alertText)
        const timer = useRef(0)
        useEffect(() => () => clearTimeout(timer.current), [])
        useEffect(() => subscribeAlert(setAlert), [])
        useEffect(() => {
          const onStart = (event) => {
            if (!dragCarriesSession(event)) return
            // The payload may only exist once the row's own dragstart handler
            // has run, so the banner also accepts the element-derived fallback.
            const known = extractSessionId(event.dataTransfer) || activeDragSession
            if (!known) {
              setTimeout(() => {
                if (activeDragSession) {
                  setOver(false)
                  setFlash('')
                  setVisible(true)
                }
              }, 0)
              return
            }
            setOver(false)
            setFlash('')
            setVisible(true)
          }
          const onStop = () => {
            activeDragSession = ''
            setVisible(false)
            setOver(false)
          }
          window.addEventListener('dragstart', onStart, true)
          window.addEventListener('dragend', onStop, true)
          return () => {
            window.removeEventListener('dragstart', onStart, true)
            window.removeEventListener('dragend', onStop, true)
          }
        }, [])
        if (!visible && !alert) return null
        const onDragOver = (event) => {
          if (!dragCarriesSession(event)) return
          event.preventDefault()
          event.stopPropagation()
          acceptDragEffect(event.dataTransfer)
          if (!over) setOver(true)
        }
        const onDrop = (event) => {
          const sessionId = extractSessionId(event.dataTransfer) || activeDragSession
          event.preventDefault()
          event.stopPropagation()
          if (!sessionId) {
            setVisible(false)
            return
          }
          activeDragSession = ''
          request('POST', 'trash', { sessionId }).then((result) => {
            setFlash(result && result.ok ? 'done' : 'error')
            notifyChanged()
            clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              setVisible(false)
              setOver(false)
              setFlash('')
            }, 900)
          })
        }
        return h('div', {
          role: 'presentation',
          onDragEnter: onDragOver,
          onDragOver,
          onDragLeave: () => setOver(false),
          onDrop,
          style: {
            position: 'fixed',
            left: '50%',
            bottom: 12,
            width: 236,
            height: 52,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            boxSizing: 'border-box',
            borderRadius: 12,
            border: over
              ? '1px solid var(--dsw-alias-brand-primary)'
              : '1px dashed var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-2)',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
            color: 'var(--dsw-alias-label-primary)',
            cursor: 'copy',
            pointerEvents: 'auto',
            userSelect: 'none',
            transform: over ? 'translateX(-50%) scale(1.02)' : 'translateX(-50%)',
            transition: 'transform 120ms ease, border-color 120ms ease',
          },
        },
          h(TrashGlyph, { size: 22, active: over, flash: alert ? 'error' : flash }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
            h('span', { style: { fontSize: 12, lineHeight: '17px', fontWeight: 600 } },
              alert ? t('notice.failed') : t('drop.label')),
            h('span', {
              style: {
                fontSize: 11,
                lineHeight: '15px',
                color: alert ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
              },
            }, alert || t('drop.hint')),
          ),
        )
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        window.addEventListener('dragstart', rememberDragStart, true)
        return () => window.removeEventListener('dragstart', rememberDragStart, true)
      })
      // Cold start: every seat this plugin fills is declared by another plugin,
      // and this bundle may be evaluated before that declaration exists.
      // `slots.inject` defers the registration until the owner declares the
      // seat; the retry loop covers a loader that only exposes `register`.
      const register = (slotName, options, Component) => {
        const mount = () => ctx.slots.register(options, Component)
        try {
          if (typeof ctx.slots.inject === 'function') {
            ctx.slots.inject(slotName, mount)
            return
          }
          mount()
        } catch (error) {
          console.warn('[dsh-recycle-bin] 槽位 ' + slotName + ' 注册失败，稍后重试', error)
          let tries = 0
          const timer = setInterval(() => {
            tries += 1
            try {
              mount()
              clearInterval(timer)
            } catch (retry) {
              if (tries >= 40) {
                clearInterval(timer)
                console.warn('[dsh-recycle-bin] 槽位 ' + slotName + ' 最终未能注册', retry)
              }
            }
          }, 100)
          if (timer && typeof timer.unref === 'function') timer.unref()
        }
      }
      register('sidebar.panellist', {
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: 25,
        label: () => t('nav.title'),
      }, makePanelIcon(t))
      register('main', {
        name: 'main',
        key: PANEL_KEY,
      }, makePanel(t))
      register('sidebar.session.row.hover', {
        name: 'sidebar.session.row.hover',
        id: PANEL_KEY + ':hover',
        order: 40,
      }, makeHoverAction(t))
      register('shell.overlay', {
        name: 'shell.overlay',
        id: PANEL_KEY + ':drop',
        order: 60,
      }, makeDropBanner(t))
      // One line in the host log per page load: proves whether the client half
      // ran during a cold start, which is the only way to tell "not loaded"
      // apart from "loaded but its seats were not declared yet".
      request('POST', 'client-boot', { inject: typeof ctx.slots.inject === 'function' ? 1 : 0 }).catch(() => {})
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
