import { supabase } from './supabase.js'

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  }
  return supabase
}

export async function getNotebooks() {
  const client = requireClient()
  const { data, error } = await client
    .from('notebooks')
    .select('id, name, created_at, notes(count)')
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    noteCount: Number(row.notes?.[0]?.count ?? 0)
  }))
}

export async function ensurePersonalNotebookSeeded(userId, notebooks) {
  const seedKey = `uninote-seeded:${userId}`
  if (notebooks.length > 0) {
    try {
      localStorage.setItem(seedKey, '1')
    } catch {
      // Ignore storage errors
    }
    return notebooks
  }

  let alreadySeeded = false
  try {
    alreadySeeded = localStorage.getItem(seedKey) === '1'
  } catch {
    alreadySeeded = false
  }

  if (alreadySeeded) return notebooks

  const created = await addNotebook({ name: 'Personal' })
  try {
    localStorage.setItem(seedKey, '1')
  } catch {
    // Ignore storage errors
  }
  return [{ ...created, noteCount: 0 }]
}

export async function getNotes(notebookId) {
  const client = requireClient()
  const { data, error } = await client
    .from('notes')
    .select('id, title, content, created_at, updated_at')
    .eq('notebook_id', notebookId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw error

  return (data ?? []).map(row => ({
    id: row.id,
    title: row.title ?? '',
    content: row.content ?? '',
    created: row.created_at,
    updatedAt: row.updated_at
  }))
}

export async function addNotebook({ name }) {
  const client = requireClient()
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) {
    throw new Error('Notebook name is required.')
  }

  const { data, error } = await client
    .from('notebooks')
    .insert({ name: trimmed })
    .select('id, name')
    .single()

  if (error) throw error
  return data
}

export async function addNote({ notebookId, title, content }) {
  const client = requireClient()
  if (!notebookId || typeof title !== 'string' || typeof content !== 'string') {
    throw new Error('A notebook, title, and note body are required.')
  }

  const { data, error } = await client
    .from('notes')
    .insert({
      notebook_id: notebookId,
      title,
      content
    })
    .select('id, title, content, created_at, updated_at')
    .single()

  if (error) throw error

  return {
    id: data.id,
    title: data.title,
    content: data.content,
    created: data.created_at,
    updatedAt: data.updated_at
  }
}

export async function updateNote({ id, title, content }) {
  const client = requireClient()
  if (!id || typeof title !== 'string' || typeof content !== 'string') {
    throw new Error('A note, title, and note body are required.')
  }

  const { data, error } = await client
    .from('notes')
    .update({ title, content })
    .eq('id', id)
    .select('updated_at')
    .single()

  if (error) throw error
  return { updatedAt: data.updated_at }
}

export async function deleteNote({ id }) {
  const client = requireClient()
  const { error } = await client
    .from('notes')
    .delete()
    .eq('id', id)

  if (error) throw error
  return true
}

export async function deleteNotebook({ id }) {
  const client = requireClient()
  const { error } = await client
    .from('notebooks')
    .delete()
    .eq('id', id)

  if (error) throw error
  return true
}
