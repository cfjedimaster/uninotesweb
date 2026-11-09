import './styles/theme.css'
import './styles/app.css'
import Alpine from 'alpinejs'
import {
  addNote,
  addNotebook,
  deleteNote,
  deleteNotebook,
  ensurePersonalNotebookSeeded,
  getNotebooks,
  getNotes,
  updateNote
} from './lib/db.js'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import { getResolvedTheme, setThemePreference, subscribeThemeChanges } from './lib/theme.js'

function attachDialogLightDismissFallbacks() {
  if ('closedBy' in HTMLDialogElement.prototype) return

  const isOutside = (event, dialog) => {
    const rect = dialog.getBoundingClientRect()
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
  }

  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false
    dialog.addEventListener('pointerdown', event => {
      pressedOutside = isOutside(event, dialog)
    })
    dialog.addEventListener('pointerup', event => {
      if (pressedOutside && isOutside(event, dialog)) {
        dialog.close()
      }
    })
  }
}

Alpine.data('uninote', () => ({
  authReady: false,
  user: null,
  loggingOut: false,
  theme: getResolvedTheme(),
  notebooks: [],
  notebookError: '',
  selectedNotebook: null,
  notes: [],
  selectedNoteId: null,
  saveTimer: null,
  savedTimer: null,
  refreshTimer: null,
  deleteTimer: null,
  savedPulse: false,
  relativeNow: Date.now(),
  saveError: '',
  toastVisible: false,
  pendingDelete: null,
  deleteNotebookIndex: null,
  deleteNotebookMessage: '',
  mobileView: 'list',
  isCompactLayout: window.matchMedia('(max-width: 960px)').matches,
  isMobileLayout: window.matchMedia('(max-width: 700px)').matches,
  drawerVisible: false,
  drawerOpen: false,
  drawerHasOpened: false,
  drawerObserver: null,

  get selectedNote() {
    return this.notes.find(note => note.id === this.selectedNoteId) ?? null
  },

  get userEmail() {
    return this.user?.email ?? ''
  },

  get userDisplayName() {
    return this.user?.email ?? 'Signed in'
  },

  get userInitial() {
    const source = this.user?.email ?? 'U'
    return source.charAt(0).toUpperCase()
  },

  setTheme(nextTheme) {
    this.theme = setThemePreference(nextTheme)
  },

  async init() {
    subscribeThemeChanges(resolved => {
      this.theme = resolved
    })

    attachDialogLightDismissFallbacks()

    if (!isSupabaseConfigured || !supabase) {
      window.location.replace('/login')
      return
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const searchParams = new URLSearchParams(window.location.search)
    const oauthError = searchParams.get('error_description') || hashParams.get('error_description')
    if (oauthError) {
      window.location.replace(`/login?error_description=${encodeURIComponent(oauthError)}`)
      return
    }

    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session) {
      window.location.replace('/login')
      return
    }

    if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
      window.history.replaceState(null, '', window.location.pathname)
    }

    this.user = data.session.user
    this.authReady = true
    this.$nextTick(() => this.setupResponsiveLayout())

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        window.location.replace('/')
      } else {
        this.user = session.user
      }
    })

    try {
      const initialNotebooks = await getNotebooks()
      this.notebooks = await ensurePersonalNotebookSeeded(this.user.id, initialNotebooks)
      if (this.notebooks.length) {
        await this.switchNotebook(0)
      }
    } catch (loadError) {
      console.error('Unable to load notebooks:', loadError)
      this.saveError = 'Unable to load your notebooks right now. Please refresh.'
    }

    this.refreshTimer = setInterval(() => {
      this.relativeNow = Date.now()
    }, 15000)
  },

  async logout() {
    if (this.loggingOut) return
    this.loggingOut = true
    try {
      await this.flushCurrent()
      if (this.pendingDelete) {
        await this.commitPendingDelete()
      }
    } catch (error) {
      console.error('Unable to flush pending changes before logout:', error)
    }

    if (supabase) {
      await supabase.auth.signOut()
    }
    window.location.replace('/')
  },

  setupResponsiveLayout() {
    const compactQuery = window.matchMedia('(max-width: 960px)')
    const mobileQuery = window.matchMedia('(max-width: 700px)')

    this.isCompactLayout = compactQuery.matches
    this.isMobileLayout = mobileQuery.matches

    compactQuery.addEventListener('change', event => {
      this.isCompactLayout = event.matches
      if (!event.matches) {
        this.resetDrawerState()
      }
    })

    mobileQuery.addEventListener('change', event => {
      this.isMobileLayout = event.matches
      if (event.matches && !this.selectedNote) {
        this.mobileView = 'list'
      }
    })

    const drawer = this.$refs.sidebarDrawer
    const scroller = this.$refs.sidebarScroller
    const sheet = this.$refs.sidebarSheet
    if (!drawer || !scroller || !sheet) return

    const visibleThreshold = Math.min(0.02, 1 / Math.max(window.innerWidth, 320))
    this.drawerObserver = new IntersectionObserver(
      entries => {
        if (!this.drawerVisible || !this.isCompactLayout) return
        const entry = entries.at(-1)
        if (!entry) return
        if (entry.intersectionRatio >= visibleThreshold) {
          this.drawerHasOpened = true
        }
        if (entry.intersectionRatio >= 0.99) {
          this.onDrawerOpened()
        } else if (this.drawerHasOpened && entry.intersectionRatio < visibleThreshold) {
          this.onDrawerClosed()
        }
      },
      { root: drawer, threshold: [visibleThreshold, 0.99, 1] }
    )
    this.drawerObserver.observe(sheet)

    if (!CSS.supports('animation-timeline: scroll()')) {
      scroller.addEventListener('scroll', () => {
        if (!this.drawerVisible || !sheet.offsetWidth) return
        const ratio = Math.max(0, Math.min(1, 1 - scroller.scrollLeft / sheet.offsetWidth))
        drawer.style.setProperty('--drawer-backdrop', String(ratio))
      }, { passive: true })
    }
  },

  setWorkspaceInert(isInert) {
    if (this.$refs.notesPanel) this.$refs.notesPanel.inert = isInert
    if (this.$refs.editorPanel) this.$refs.editorPanel.inert = isInert
  },

  async openDrawer() {
    if (!this.isCompactLayout || this.drawerVisible) return
    const drawer = this.$refs.sidebarDrawer
    const scroller = this.$refs.sidebarScroller
    if (!drawer || !scroller) return

    this.drawerHasOpened = false
    this.drawerVisible = true

    await this.$nextTick()

    if (!CSS.supports('scroll-initial-target', 'nearest') || scroller.scrollLeft === 0) {
      if (!CSS.supports('animation-timeline: scroll()')) {
        drawer.style.setProperty('--drawer-backdrop', '0')
      }
      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' })
      await new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    }

    if (!this.drawerVisible) return
    scroller.scrollTo({ left: 0, behavior: 'auto' })
  },

  closeDrawer() {
    if (!this.drawerVisible) return
    const scroller = this.$refs.sidebarScroller
    if (!scroller || !this.isCompactLayout || !this.drawerHasOpened) {
      this.onDrawerClosed()
      return
    }
    scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' })
  },

  onDrawerOpened() {
    if (!this.drawerVisible || !this.isCompactLayout) return
    this.drawerOpen = true
    this.setWorkspaceInert(true)
    const anyModalOpen = this.$refs.newNotebookDialog?.open || this.$refs.deleteNotebookDialog?.open
    if (!anyModalOpen && !this.$refs.sidebarDrawer?.contains(document.activeElement)) {
      this.$refs.sidebarSheet?.focus({ preventScroll: true })
    }
  },

  onDrawerClosed() {
    const focusWasInDrawer = Boolean(this.$refs.sidebarDrawer?.contains(document.activeElement))
    const anyModalOpen = Boolean(this.$refs.newNotebookDialog?.open || this.$refs.deleteNotebookDialog?.open)
    this.resetDrawerState()
    if (focusWasInDrawer && !anyModalOpen && this.isCompactLayout) {
      this.$nextTick(() => {
        this.$refs.drawerToggle?.focus({ preventScroll: true })
      })
    }
  },

  resetDrawerState() {
    this.drawerVisible = false
    this.drawerOpen = false
    this.drawerHasOpened = false
    this.setWorkspaceInert(false)
    this.$refs.sidebarDrawer?.style.removeProperty('--drawer-backdrop')
  },

  handleDrawerBackdropClick(event) {
    if (!this.isCompactLayout || !this.drawerVisible) return
    if (!this.$refs.sidebarSheet?.contains(event.target)) {
      this.closeDrawer()
    }
  },

  async switchNotebook(index) {
    if (index === this.selectedNotebook) {
      if (this.mobileView === 'editor') {
        if (!await this.leaveCurrentNote()) return
        if (!this.selectedNote) {
          this.selectedNoteId = this.notes[0]?.id ?? null
        }
        this.mobileView = 'list'
      }
      this.closeDrawer()
      return
    }
    if (!await this.leaveCurrentNote()) return
    this.selectedNotebook = index
    this.notes = await getNotes(this.notebooks[index].id)
    this.notes.forEach(note => {
      note._savedTitle = note.title
      note._savedContent = note.content
      note._new = false
      note._createdInSession = false
    })
    this.filterPendingDelete()
    this.selectedNoteId = this.notes[0]?.id ?? null
    this.mobileView = 'list'
    this.syncNotebookCount(index)
    this.closeDrawer()
  },

  async selectNote(note, { openEditor = false } = {}) {
    if (note.id === this.selectedNoteId) {
      if (openEditor) this.mobileView = 'editor'
      return
    }
    if (!await this.leaveCurrentNote()) return
    this.selectedNoteId = note.id
    if (openEditor) this.mobileView = 'editor'
  },

  async backToList(event) {
    const viaKeyboard = event?.detail === 0
    if (!await this.leaveCurrentNote()) return
    if (!this.selectedNote) {
      this.selectedNoteId = this.notes[0]?.id ?? null
    }
    this.mobileView = 'list'
    if (viaKeyboard) {
      this.$nextTick(() => {
        const activeIndex = this.notes.findIndex(note => note.id === this.selectedNoteId)
        const cards = this.$el.querySelectorAll('.note-card')
        const target = (activeIndex >= 0 ? cards[activeIndex] : cards[0]) ?? this.$el.querySelector('.add-note')
        target?.focus({ preventScroll: true })
      })
    }
  },

  async leaveCurrentNote() {
    const note = this.selectedNote
    if (!note) return true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!await this.flushNote(note)) return false
    const empty = !note.title.trim() && !note.content.trim()
    if (note._new && empty) {
      this.notes = this.notes.filter(item => item.id !== note.id)
      this.syncNotebookCount(this.selectedNotebook)
    } else if (note._createdInSession && empty) {
      try {
        await deleteNote({ id: note.id })
      } catch (error) {
        console.error('Unable to remove an empty note:', error)
        this.saveError = 'Unable to remove this empty note. Please try again.'
        return false
      }
      this.notes = this.notes.filter(item => item.id !== note.id)
      this.syncNotebookCount(this.selectedNotebook)
    } else {
      note._createdInSession = false
    }
    return true
  },

  createNote() {
    if (this.selectedNotebook === null) return
    void this.startNewNote()
  },

  async startNewNote() {
    if (!await this.leaveCurrentNote()) return
    const note = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: '',
      content: '',
      updatedAt: new Date().toISOString(),
      _new: true,
      _createdInSession: false,
      _savedTitle: '',
      _savedContent: ''
    }
    this.notes.unshift(note)
    this.selectedNoteId = note.id
    this.mobileView = 'editor'
    this.syncNotebookCount(this.selectedNotebook)
    this.closeDrawer()
    this.$nextTick(() => this.$refs.noteTitle?.focus())
  },

  scheduleSave(note) {
    this.saveError = ''
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flushNote(note)
    }, 800)
  },

  async flushCurrent() {
    const note = this.selectedNote
    if (!note) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.flushNote(note)
  },

  async flushNote(note) {
    try {
      await this.saveNote(note)
      return true
    } catch (error) {
      this.reportSaveError(error)
      return false
    }
  },

  async saveNote(note) {
    if (note._saving) {
      await note._saving
      return this.saveNote(note)
    }
    if (note._new && !note.title.trim() && !note.content.trim()) return
    if (!note._new && note.title === note._savedTitle && note.content === note._savedContent) return

    const title = note.title
    const content = note.content
    note._saving = (async () => {
      const saved = note._new
        ? await addNote({
          notebookId: this.notebooks[this.selectedNotebook].id,
          title,
          content
        })
        : await updateNote({ id: note.id, title, content })

      if (!saved) throw new Error('The note could not be saved.')
      if (note._new) {
        note.id = saved.id
        note._new = false
        note._createdInSession = true
        this.selectedNoteId = note.id
        this.syncNotebookCount(this.selectedNotebook)
      }
      note._savedTitle = title
      note._savedContent = content
      note.updatedAt = saved.updatedAt
      this.notes.sort((first, second) =>
        new Date(second.updatedAt.replace(' ', 'T')).getTime() -
        new Date(first.updatedAt.replace(' ', 'T')).getTime()
      )
      this.saveError = ''
      this.showSaved()
    })()

    try {
      await note._saving
    } finally {
      delete note._saving
    }
    if (note.title !== title || note.content !== content) return this.saveNote(note)
  },

  showSaved() {
    this.savedPulse = true
    if (this.savedTimer) clearTimeout(this.savedTimer)
    this.savedTimer = setTimeout(() => {
      this.savedPulse = false
    }, 1500)
  },

  reportSaveError(error) {
    console.error('Unable to save note:', error)
    this.saveError = 'Unable to save this note. Your changes are still here; try again.'
  },

  formatLastEdited(value) {
    if (!value) return 'Not saved yet'
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
    if (Number.isNaN(date.getTime())) return 'Not saved yet'
    const age = Math.max(0, this.relativeNow - date.getTime())
    if (age < 60000) return 'Just now'

    const now = new Date(this.relativeNow)
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    if (sameDay) {
      return `Today, ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)}`
    }
    if (age < 7 * 24 * 60 * 60 * 1000) {
      return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)
    }
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
    }).format(date)
  },

  moveSelection(direction) {
    if (!this.notes.length) return
    const current = this.notes.findIndex(note => note.id === this.selectedNoteId)
    const next = current < 0
      ? 0
      : Math.max(0, Math.min(this.notes.length - 1, current + direction))
    const note = this.notes[next]
    void this.selectNote(note)
    this.$nextTick(() => {
      this.$el.querySelectorAll('.note-card')[next]?.focus()
    })
  },

  async copySelectedNote() {
    const note = this.selectedNote
    if (!note) return
    try {
      await navigator.clipboard.writeText(`${note.title}\n\n${note.content}`)
    } catch (error) {
      console.error('Unable to copy note:', error)
      this.saveError = 'Unable to copy this note to the clipboard.'
    }
  },

  async deleteSelectedNote() {
    const note = this.selectedNote
    if (!note) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      await this.saveNote(note)
    } catch (error) {
      this.reportSaveError(error)
      return
    }
    if (note._new) {
      this.notes = this.notes.filter(item => item.id !== note.id)
      this.selectedNoteId = this.notes[0]?.id ?? null
      this.syncNotebookCount(this.selectedNotebook)
      if (this.isMobileLayout) this.mobileView = 'list'
      return
    }
    if (this.pendingDelete) await this.commitPendingDelete()
    const index = this.notes.findIndex(item => item.id === note.id)
    if (index < 0) return
    this.notes.splice(index, 1)
    this.selectedNoteId = this.notes[Math.min(index, this.notes.length - 1)]?.id ?? null
    if (this.isMobileLayout) this.mobileView = 'list'
    this.pendingDelete = {
      note,
      index,
      notebookId: this.notebooks[this.selectedNotebook].id
    }
    this.syncNotebookCount(this.selectedNotebook)
    this.toastVisible = true
    this.deleteTimer = setTimeout(() => {
      void this.commitPendingDelete()
    }, 6000)
  },

  async commitPendingDelete() {
    if (!this.pendingDelete) return
    if (this.deleteTimer) clearTimeout(this.deleteTimer)
    this.deleteTimer = null
    const pending = this.pendingDelete
    this.pendingDelete = null
    this.toastVisible = false
    try {
      await deleteNote({ id: pending.note.id })
    } catch (error) {
      console.error('Unable to delete note:', error)
      this.saveError = 'Unable to delete this note. It has been restored.'
      if (
        this.notebooks.some(notebook => notebook.id === pending.notebookId) &&
        this.notebooks[this.selectedNotebook]?.id === pending.notebookId
      ) {
        this.notes.splice(Math.min(pending.index, this.notes.length), 0, pending.note)
        this.selectedNoteId = pending.note.id
        this.syncNotebookCount(this.selectedNotebook)
      }
    }
  },

  undoDelete() {
    if (!this.pendingDelete) return
    if (this.deleteTimer) clearTimeout(this.deleteTimer)
    const { note, index, notebookId } = this.pendingDelete
    this.deleteTimer = null
    this.pendingDelete = null
    this.toastVisible = false
    if (this.notebooks[this.selectedNotebook]?.id === notebookId) {
      this.notes.splice(Math.min(index, this.notes.length), 0, note)
      this.selectedNoteId = note.id
      this.syncNotebookCount(this.selectedNotebook)
    }
  },

  filterPendingDelete() {
    if (!this.pendingDelete || this.pendingDelete.notebookId !== this.notebooks[this.selectedNotebook]?.id) return
    this.notes = this.notes.filter(note => note.id !== this.pendingDelete.note.id)
  },

  syncNotebookCount(index) {
    if (index === null || !this.notebooks[index]) return
    this.notebooks[index].noteCount = this.notes.length
  },

  openNewNotebookModal() {
    this.notebookError = ''
    this.$refs.notebookName.value = ''
    this.$refs.newNotebookDialog.showModal()
  },

  async saveNewNotebook() {
    const name = this.$refs.notebookName.value.trim()
    if (!name) {
      this.$refs.newNotebookDialog.close()
      return
    }

    this.notebookError = ''
    try {
      if (!await this.leaveCurrentNote()) {
        this.notebookError = 'Save your current note before creating a notebook.'
        return
      }
      const notebook = await addNotebook({ name })
      this.notebooks.push({ ...notebook, noteCount: 0 })
      this.$refs.newNotebookDialog.close()
      await this.switchNotebook(this.notebooks.length - 1)
    } catch (error) {
      console.error('Unable to save notebook:', error)
      this.notebookError = 'Unable to save notebook. Please try again.'
    }
  },

  async openDeleteNotebookDialog(index) {
    const notebook = this.notebooks[index]
    this.deleteNotebookIndex = index
    this.notebookError = ''
    let noteCount = notebook.noteCount
    try {
      noteCount = (await getNotes(notebook.id)).length
    } catch (error) {
      console.error('Unable to count notebook notes:', error)
      this.notebookError = 'Unable to load the notebook note count.'
    }
    this.deleteNotebookMessage = `Delete '${notebook.name}' and its ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}? This can't be undone.`
    this.$refs.deleteNotebookDialog.showModal()
  },

  async confirmDeleteNotebook() {
    const index = this.deleteNotebookIndex
    const notebook = this.notebooks[index]
    if (!notebook) return
    try {
      if (this.selectedNotebook === index && !await this.leaveCurrentNote()) return
      await deleteNotebook({ id: notebook.id })
      if (this.pendingDelete?.notebookId === notebook.id) {
        if (this.deleteTimer) clearTimeout(this.deleteTimer)
        this.deleteTimer = null
        this.pendingDelete = null
        this.toastVisible = false
      }
      this.notebooks.splice(index, 1)
      this.$refs.deleteNotebookDialog.close()
      if (this.selectedNotebook === index) {
        this.selectedNotebook = null
        this.notes = []
        this.selectedNoteId = null
        this.mobileView = 'list'
        if (this.notebooks.length) {
          await this.switchNotebook(Math.min(index, this.notebooks.length - 1))
        }
      } else if (this.selectedNotebook > index) {
        this.selectedNotebook--
      }
    } catch (error) {
      console.error('Unable to delete notebook:', error)
      this.notebookError = 'Unable to delete notebook. Please try again.'
    }
  },

  handleGlobalKeydown(event) {
    if (event.key === 'Escape') {
      const anyModalOpen = this.$refs.newNotebookDialog?.open || this.$refs.deleteNotebookDialog?.open
      if (!anyModalOpen && this.drawerVisible) {
        event.preventDefault()
        this.closeDrawer()
      }
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'n') return
    event.preventDefault()
    if (event.shiftKey) this.openNewNotebookModal()
    else this.createNote()
  },

  onBeforeUnload() {
    if (this.pendingDelete) void this.commitPendingDelete()
    const note = this.selectedNote
    if (!note || (note._new && !note.title.trim() && !note.content.trim())) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (note._createdInSession && !note.title.trim() && !note.content.trim()) {
      void this.saveNote(note)
        .then(() => deleteNote({ id: note.id }))
        .catch(error => this.reportSaveError(error))
      return
    }
    void this.saveNote(note).catch(error => this.reportSaveError(error))
  }
}))

Alpine.start()
