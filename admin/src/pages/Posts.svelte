<script>
import { posts, categories } from '../api.js'
import Icon from '@iconify/svelte'
import { addToast } from '../stores.svelte.js'
import { onSSE } from '../lib/sse.js'
import { onMount } from 'svelte'

let postList = $state([])
let categoryList = $state([])
let loading = $state(true)
let search = $state('')
let filterCategory = $state('')
let filterStatus = $state('')
let sortOrder = $state('desc')
let page = $state(1)
let totalPages = $state(1)
let totalPosts = $state(0)
let pageSize = $state(10)
let deleteTarget = $state(null)
let selectedIds = $state(new Set())
let selectAll = $state(false)
let showBatchBar = $state(false)
let viewMode = $state('table')
let searchTimer = null
let previewPost = $state(null)
let showPreview = $state(false)
let showMoveCategoryModal = $state(false)
let moveCategoryTarget = $state('')
let showExportMenu = $state(false)
let expandedRow = $state(null)
let _skipNextSSE = false

let stats = $state({ total: 0, published: 0, draft: 0, pinned: 0, today: 0 })

async function loadData(silent = false) {
  if (!silent) loading = true
  try {
    const params = { page, pageSize, sort: sortOrder }
    if (search) params.search = search
    if (filterCategory) params.category = filterCategory
    if (filterStatus) params.draft = filterStatus === 'draft' ? 'true' : 'false'
    const data = await posts.list(params)
    postList = data.posts || data.data || []
    const pag = data.pagination || {}
    totalPages = pag.totalPages || Math.ceil((pag.total || postList.length) / pageSize) || 1
    totalPosts = pag.total || 0
  } catch (e) {
    if (!silent) addToast('加载文章列表失败', 'error')
  } finally {
    if (!silent) loading = false
  }
}

async function loadCategories() {
  try {
    const data = await categories.list()
    categoryList = data.data || data || []
  } catch (e) {}
}

async function loadStats() {
  try {
    const data = await posts.stats()
    stats = data
  } catch (e) {}
}

onMount(() => {
  loadData()
  loadCategories()
  loadStats()
  const off = onSSE((data) => {
    if (_skipNextSSE) { _skipNextSSE = false; return }
    if (data.resources.includes('posts')) {
      loadData(true)
      loadStats()
    } else if (data.resources.includes('categories')) {
      loadCategories()
    }
  })
  return off
})

async function handleDelete(id) {
  try {
    _skipNextSSE = true
    postList = postList.filter(p => (p.id || p._id) !== id)
    totalPosts = Math.max(0, totalPosts - 1)
    selectedIds = new Set([...selectedIds].filter(sid => sid !== id))
    addToast('删除成功', 'success')
    deleteTarget = null
    await posts.delete(id)
    loadData(true)
    loadStats()
  } catch (e) {
    addToast(e.message || '删除失败', 'error')
    deleteTarget = null
    loadData(true)
  }
}

async function handleToggleDraft(post) {
  try {
    const pid = post.id || post._id
    const newDraft = !post.draft
    _skipNextSSE = true
    postList = postList.map(p => (p.id || p._id) === pid ? { ...p, draft: newDraft } : p)
    stats = { ...stats, published: stats.published + (newDraft ? -1 : 1), draft: stats.draft + (newDraft ? 1 : -1) }
    addToast(post.draft ? '已发布' : '已转为草稿', 'success')
    await posts.toggleDraft(pid)
    loadData(true)
    loadStats()
  } catch (e) {
    addToast(e.message || '操作失败', 'error')
    loadData(true)
    loadStats()
  }
}

async function handleTogglePin(post) {
  try {
    const pid = post.id || post._id
    const newPin = !post.pin_top
    _skipNextSSE = true
    postList = postList.map(p => (p.id || p._id) === pid ? { ...p, pin_top: newPin } : p)
    stats = { ...stats, pinned: stats.pinned + (newPin ? 1 : -1) }
    addToast(post.pin_top ? '已取消置顶' : '已置顶', 'success')
    await posts.togglePin(pid)
    loadData(true)
    loadStats()
  } catch (e) {
    addToast(e.message || '操作失败', 'error')
    loadData(true)
    loadStats()
  }
}

async function handleClone(post) {
  try {
    _skipNextSSE = true
    addToast('正在克隆...', 'info')
    const res = await posts.clone(post.id || post._id)
    addToast('已克隆文章「' + post.title + '」', 'success')
    loadData(true)
    loadStats()
  } catch (e) {
    addToast(e.message || '克隆失败', 'error')
  }
}

async function handleBatch(action, extra = {}) {
  if (selectedIds.size === 0) { addToast('请先选择文章', 'warning'); return }
  try {
    _skipNextSSE = true
    addToast('正在处理...', 'info')
    const res = await posts.batch([...selectedIds], action, extra)
    addToast(res.message || '操作成功', 'success')
    selectedIds = new Set()
    selectAll = false
    showBatchBar = false
    loadData(true)
    loadStats()
  } catch (e) {
    addToast(e.message || '操作失败', 'error')
  }
}

async function handleMoveCategory() {
  if (!moveCategoryTarget && moveCategoryTarget !== '') { addToast('请选择分类', 'warning'); return }
  try {
    _skipNextSSE = true
    addToast('正在移动...', 'info')
    await posts.batch([...selectedIds], 'moveCategory', { category: moveCategoryTarget })
    addToast('已移动分类', 'success')
    selectedIds = new Set()
    selectAll = false
    showBatchBar = false
    showMoveCategoryModal = false
    moveCategoryTarget = ''
    loadData(true)
  } catch (e) {
    addToast(e.message || '操作失败', 'error')
  }
}

function handleSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page = 1
    loadData()
  }, 400)
}

function toggleSelect(id) {
  const newSet = new Set(selectedIds)
  if (newSet.has(id)) newSet.delete(id)
  else newSet.add(id)
  selectedIds = newSet
  showBatchBar = newSet.size > 0
  selectAll = postList.length > 0 && newSet.size === postList.length
}

function toggleSelectAll() {
  if (selectAll) {
    selectedIds = new Set()
    selectAll = false
    showBatchBar = false
  } else {
    selectedIds = new Set(postList.map(p => p.id || p._id))
    selectAll = true
    showBatchBar = true
  }
}

function getPostUrl(post) {
  const slug = post.slug_id || post.slug
  if (!slug) return null
  return `${window.location.origin}/blog/${slug}`
}

function openPostLink(post) {
  const url = getPostUrl(post)
  if (!url) { addToast('无法获取文章链接', 'error'); return }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function copyPostLink(post) {
  const url = getPostUrl(post)
  if (!url) { addToast('无法获取文章链接', 'error'); return }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => addToast('已复制链接', 'success')).catch(() => addToast('复制失败', 'error'))
  } else {
    addToast('复制失败', 'error')
  }
}

function exportPosts(format) {
  showExportMenu = false
  const dataToExport = selectedIds.size > 0
    ? postList.filter(p => selectedIds.has(p.id || p._id))
    : postList

  if (dataToExport.length === 0) {
    addToast('没有可导出的文章', 'warning')
    return
  }

  let content = ''
  let filename = ''
  let mimeType = ''

  if (format === 'json') {
    const exportData = dataToExport.map(p => ({
      title: p.title,
      slug_id: p.slug_id,
      content: p.content,
      description: p.description,
      category: p.category,
      draft: p.draft,
      pin_top: p.pin_top,
      image: p.image,
      pub_date: p.pub_date
    }))
    content = JSON.stringify(exportData, null, 2)
    filename = `posts-export-${new Date().toISOString().slice(0, 10)}.json`
    mimeType = 'application/json'
  } else if (format === 'md') {
    content = dataToExport.map(p => {
      let md = `# ${p.title}\n\n`
      if (p.description) md += `> ${p.description}\n\n`
      md += `---\n\n`
      md += p.content || ''
      return md
    }).join('\n\n---\n\n')
    filename = `posts-export-${new Date().toISOString().slice(0, 10)}.md`
    mimeType = 'text/markdown'
  } else if (format === 'csv') {
    const headers = ['标题', 'Slug', '分类', '状态', '置顶', '描述', '发布日期', '创建日期']
    const rows = dataToExport.map(p => [
      `"${(p.title || '').replace(/"/g, '""')}"`,
      p.slug_id || '',
      p.category || '',
      p.draft ? '草稿' : '已发布',
      p.pin_top ? '是' : '否',
      `"${(p.description || '').replace(/"/g, '""')}"`,
      p.pub_date || '',
      p.created_at || ''
    ].join(','))
    content = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    filename = `posts-export-${new Date().toISOString().slice(0, 10)}.csv`
    mimeType = 'text/csv'
  }

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  addToast(`已导出 ${dataToExport.length} 篇文章`, 'success')
}

async function openPreview(post) {
  try {
    const fullPost = await posts.get(post.id || post._id)
    previewPost = fullPost
    showPreview = true
  } catch (e) {
    addToast('加载文章内容失败', 'error')
  }
}

function formatDate(date) {
  if (!date) return '-'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function getRelativeTime(date) {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d2 = Math.floor(h / 24)
  if (d2 < 30) return `${d2}天前`
  return formatDate(date)
}

function getWordCount(content) {
  if (!content) return 0
  return content.replace(/[#*`\[\]()>|~-]/g, '').replace(/\s+/g, '').length
}

function getReadingTime(content) {
  const chars = getWordCount(content)
  return Math.max(1, Math.ceil(chars / 500))
}

function toggleExpand(id) {
  expandedRow = expandedRow === id ? null : id
}
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between flex-wrap gap-2">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">文章管理</h2>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="relative">
        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input
          type="text"
          bind:value={search}
          oninput={handleSearchInput}
          placeholder="搜索文章..."
          class="pl-8 pr-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent w-40 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>
      <select
        bind:value={filterCategory}
        onchange={() => { page = 1; loadData() }}
        class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 text-sm outline-none"
      >
        <option value="">全部分类</option>
        {#each categoryList as cat}
          <option value={cat.name || cat.slug || cat.id || cat._id}>{cat.name}</option>
        {/each}
      </select>
      <select
        bind:value={filterStatus}
        onchange={() => { page = 1; loadData() }}
        class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 text-sm outline-none"
      >
        <option value="">全部状态</option>
        <option value="published">已发布</option>
        <option value="draft">草稿</option>
      </select>
      <div class="relative">
        <button
          onclick={() => showExportMenu = !showExportMenu}
          class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-600 dark:text-gray-400 text-sm hover:bg-white/80 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-1"
        >
          <Icon icon="mdi:download" width="14" height="14" />
          导出
        </button>
        {#if showExportMenu}
          <div class="absolute right-0 top-full mt-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg py-1 z-30 w-36">
            <button onclick={() => exportPosts('json')} class="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/50 transition-colors">导出 JSON</button>
            <button onclick={() => exportPosts('md')} class="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/50 transition-colors">导出 Markdown</button>
            <button onclick={() => exportPosts('csv')} class="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/50 transition-colors">导出 CSV</button>
          </div>
        {/if}
      </div>
      <div class="flex rounded-full border border-gray-200 dark:border-gray-700 overflow-hidden bg-white/40 dark:bg-gray-800/40 backdrop-blur-xl">
        <button
          onclick={() => viewMode = 'table'}
          class="px-3 py-1.5 text-xs font-medium transition-colors rounded-full {viewMode === 'table' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}"
        >
          表格
        </button>
        <button
          onclick={() => viewMode = 'card'}
          class="px-3 py-1.5 text-xs font-medium transition-colors rounded-full {viewMode === 'card' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}"
        >
          卡片
        </button>
      </div>
      <a href="#/posts/new" class="px-4 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-xs font-medium transition-colors text-center shrink-0">
        + 新建文章
      </a>
    </div>
  </div>

  <div class="flex gap-3 overflow-x-auto pb-1">
    <button onclick={() => { filterStatus = ''; filterCategory = ''; page = 1; loadData() }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 min-w-[100px] flex-1 text-left transition-colors shadow-[0_8px_32px_rgba(0,0,0,0.06)] {filterStatus === '' && filterCategory === '' ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">全部文章</p>
      <p class="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
    </button>
    <button onclick={() => { filterStatus = 'published'; page = 1; loadData() }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 min-w-[100px] flex-1 text-left transition-colors shadow-[0_8px_32px_rgba(0,0,0,0.06)] {filterStatus === 'published' ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">已发布</p>
      <p class="text-xl font-bold text-green-600 dark:text-green-400">{stats.published}</p>
    </button>
    <button onclick={() => { filterStatus = 'draft'; page = 1; loadData() }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 min-w-[100px] flex-1 text-left transition-colors shadow-[0_8px_32px_rgba(0,0,0,0.06)] {filterStatus === 'draft' ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">草稿</p>
      <p class="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.draft}</p>
    </button>
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-3 min-w-[100px] flex-1 text-left shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">置顶</p>
      <p class="text-xl font-bold text-blue-600 dark:text-blue-400">{stats.pinned}</p>
    </div>
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-3 min-w-[100px] flex-1 text-left shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">今日新增</p>
      <p class="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.today || 0}</p>
    </div>
  </div>

  <div class="flex items-center justify-between gap-2 flex-wrap">
    <div class="flex items-center gap-1 bg-white/40 dark:bg-gray-800/40 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-1 overflow-x-auto">
      <button onclick={() => { filterStatus = ''; page = 1; loadData() }} class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors {filterStatus === '' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}">
        全部
      </button>
      <button onclick={() => { filterStatus = 'published'; page = 1; loadData() }} class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors {filterStatus === 'published' ? 'bg-green-600 dark:bg-green-500 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}">
        已发布
      </button>
      <button onclick={() => { filterStatus = 'draft'; page = 1; loadData() }} class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors {filterStatus === 'draft' ? 'bg-amber-500 dark:bg-amber-400 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}">
        草稿
      </button>
    </div>
    <div class="flex items-center gap-1 bg-white/40 dark:bg-gray-800/40 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-1">
      <button onclick={() => { sortOrder = 'desc'; page = 1; loadData() }} class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors {sortOrder === 'desc' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}">
        最新
      </button>
      <button onclick={() => { sortOrder = 'asc'; page = 1; loadData() }} class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors {sortOrder === 'asc' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-gray-700/30'}">
        最旧
      </button>
    </div>
  </div>

  {#if showBatchBar}
    <div class="bg-gray-100/60 dark:bg-gray-700/50 backdrop-blur-xl border border-gray-400/20 dark:border-gray-600/20 rounded-2xl px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <span class="text-sm text-gray-700 dark:text-gray-300">已选择 <strong>{selectedIds.size}</strong> 篇文章</span>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick={() => handleBatch('publish')} class="text-xs px-3 py-1.5 rounded-full bg-green-500/80 text-white hover:bg-green-600 transition-colors">批量发布</button>
        <button onclick={() => handleBatch('draft')} class="text-xs px-3 py-1.5 rounded-full bg-amber-500/80 text-white hover:bg-amber-600 transition-colors">批量转草稿</button>
        <button onclick={() => handleBatch('pin')} class="text-xs px-3 py-1.5 rounded-full bg-blue-500/80 text-white hover:bg-blue-600 transition-colors">批量置顶</button>
        <button onclick={() => handleBatch('unpin')} class="text-xs px-3 py-1.5 rounded-full bg-gray-500/80 text-white hover:bg-gray-600 transition-colors">取消置顶</button>
        <button onclick={() => { showMoveCategoryModal = true }} class="text-xs px-3 py-1.5 rounded-full bg-indigo-500/80 text-white hover:bg-indigo-600 transition-colors">移动分类</button>
        <button onclick={() => handleBatch('delete')} class="text-xs px-3 py-1.5 rounded-full bg-red-500/80 text-white hover:bg-red-600 transition-colors">批量删除</button>
        <button onclick={() => { selectedIds = new Set(); selectAll = false; showBatchBar = false }} class="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">取消</button>
      </div>
    </div>
  {/if}

  {#if viewMode === 'card'}
    <div class="space-y-3">
      {#if loading}
        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 px-4 py-8 text-center text-gray-400 dark:text-gray-500">加载中...</div>
      {:else if postList.length === 0}
        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 px-4 py-8 text-center text-gray-400 dark:text-gray-500">暂无文章</div>
      {:else}
        <div class="flex items-center gap-2 px-1">
          <input type="checkbox" checked={selectAll} onchange={toggleSelectAll} class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-gray-400" />
          <span class="text-xs text-gray-500 dark:text-gray-400">全选</span>
          <span class="text-xs text-gray-400 dark:text-gray-500 ml-auto">共 {totalPosts} 篇</span>
        </div>
        {#each postList as post (post.id || post._id)}
          {@const pid = post.id || post._id}
          <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2 {selectedIds.has(pid) ? 'ring-2 ring-gray-400 dark:ring-gray-500' : ''} {post.pin_top ? 'border-l-[4px] border-l-blue-500' : ''}">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <input type="checkbox" checked={selectedIds.has(pid)} onchange={() => toggleSelect(pid)} class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-gray-400 shrink-0" />
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    {#if post.pin_top}
                      <Icon icon="mdi:pin" width="14" height="14" class="text-blue-500 shrink-0" />
                    {/if}
                    <a href="#/posts/{pid}/edit" class="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300 transition-colors truncate max-w-[300px]">
                      {post.title}
                    </a>
                    <span class="text-[10px] px-1.5 py-0 rounded-full {post.draft ? 'bg-amber-50/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-green-50/80 dark:bg-green-900/30 text-green-700 dark:text-green-400'} shrink-0">
                      {post.draft ? '草稿' : '已发布'}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                    <span>{post.category?.name || post.category || '未分类'}</span>
                    <span>·</span>
                    <span>{getRelativeTime(post.pub_date || post.created_at)}</span>
                    <span>·</span>
                    <span>{getWordCount(post.content)}字</span>
                    <span>·</span>
                    <span>约{getReadingTime(post.content)}分钟</span>
                  </div>
                </div>
              </div>
            </div>
            {#if post.description}
              <p class="text-xs text-gray-500 dark:text-gray-400 break-words pl-7 line-clamp-2">{post.description}</p>
            {/if}
            {#if expandedRow === pid && post.content}
              <div class="ml-7 p-3 bg-gray-50/80 dark:bg-gray-800/50 rounded-xl text-sm text-gray-700 dark:text-gray-300 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                {post.content.slice(0, 500)}{post.content.length > 500 ? '...' : ''}
              </div>
            {/if}
            <div class="flex items-center gap-1 pl-7 flex-wrap">
              <a href="#/posts/{pid}/edit" class="text-[11px] px-2 py-0.5 rounded-full text-gray-900 dark:text-gray-100 bg-gray-100/80 dark:bg-gray-700/50 hover:bg-gray-200/80 dark:hover:bg-gray-600/50 transition-colors whitespace-nowrap">编辑</a>
              <button onclick={() => handleToggleDraft(post)} class="text-[11px] px-2 py-0.5 rounded-full text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-900/30 hover:bg-amber-100/80 dark:hover:bg-amber-900/50 transition-colors whitespace-nowrap">
                {post.draft ? '发布' : '转草稿'}
              </button>
              <button onclick={() => handleTogglePin(post)} class="text-[11px] px-2 py-0.5 rounded-full text-blue-600 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-900/30 hover:bg-blue-100/80 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap">
                {post.pin_top ? '取消置顶' : '置顶'}
              </button>
              <button onclick={() => openPreview(post)} class="text-[11px] px-2 py-0.5 rounded-full text-purple-600 dark:text-purple-400 bg-purple-50/80 dark:bg-purple-900/30 hover:bg-purple-100/80 dark:hover:bg-purple-900/50 transition-colors whitespace-nowrap">预览</button>
              <button onclick={() => handleClone(post)} class="text-[11px] px-2 py-0.5 rounded-full text-indigo-600 dark:text-indigo-400 bg-indigo-50/80 dark:bg-indigo-900/30 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/50 transition-colors whitespace-nowrap">克隆</button>
              <button onclick={() => openPostLink(post)} class="text-[11px] px-2 py-0.5 rounded-full text-teal-600 dark:text-teal-400 bg-teal-50/80 dark:bg-teal-900/30 hover:bg-teal-100/80 dark:hover:bg-teal-900/50 transition-colors whitespace-nowrap">跳转</button>
              <button onclick={() => copyPostLink(post)} class="text-[11px] px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400 bg-gray-500/10 dark:bg-gray-400/15 hover:bg-gray-500/20 dark:hover:bg-gray-400/25 transition-colors whitespace-nowrap">复制链接</button>
              <button onclick={() => toggleExpand(pid)} class="text-[11px] px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400 bg-gray-500/10 dark:bg-gray-400/15 hover:bg-gray-500/20 dark:hover:bg-gray-400/25 transition-colors whitespace-nowrap">
                {expandedRow === pid ? '收起' : '展开'}
              </button>
              <button onclick={() => deleteTarget = post} class="text-[11px] px-2 py-0.5 rounded-full text-red-600 dark:text-red-400 bg-red-50/80 dark:bg-red-900/30 hover:bg-red-100/80 dark:hover:bg-red-900/50 transition-colors whitespace-nowrap">删除</button>
            </div>
          </div>
        {/each}
      {/if}

      {#if postList.length > 0}
        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">共 {totalPosts} 篇</span>
              <select onchange={(e) => { pageSize = parseInt(e.target.value); page = 1; loadData() }} class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-gray-400">
                <option value="10" selected={pageSize === 10}>10条/页</option>
                <option value="20" selected={pageSize === 20}>20条/页</option>
                <option value="50" selected={pageSize === 50}>50条/页</option>
              </select>
            </div>
            <div class="flex gap-2 shrink-0">
              <button onclick={() => { if (page > 1) { page--; loadData() } }} disabled={page <= 1} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
              <button onclick={() => { if (page < totalPages) { page++; loadData() } }} disabled={page >= totalPages} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
            </div>
          </div>
          <div class="flex items-center justify-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <span class="text-sm text-gray-400 dark:text-gray-500">第 {page} / {totalPages} 页</span>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[800px]">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-800/40">
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 w-10">
                <input type="checkbox" checked={selectAll} onchange={toggleSelectAll} class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-gray-400" />
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">标题</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell whitespace-nowrap">分类</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">状态</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell whitespace-nowrap">字数</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell whitespace-nowrap">发布日期</th>
              <th class="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            {#if loading}
              <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 dark:text-gray-500">加载中...</td></tr>
            {:else if postList.length === 0}
              <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 dark:text-gray-500">暂无文章</td></tr>
            {:else}
              {#each postList as post (post.id || post._id)}
                {@const pid = post.id || post._id}
                <tr class="hover:bg-gray-100/60 dark:hover:bg-gray-700/50 transition-colors {selectedIds.has(pid) ? 'bg-gray-100/60 dark:bg-gray-700/50' : ''} {post.pin_top ? 'bg-blue-50/40 dark:bg-blue-900/20 border-l-4 border-l-blue-500' : ''}">
                  <td class="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(pid)} onchange={() => toggleSelect(pid)} class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-gray-400" />
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-1.5">
                      {#if post.pin_top}
                        <Icon icon="mdi:pin" width="14" height="14" class="text-blue-500 shrink-0" />
                      {/if}
                      <a href="#/posts/{pid}/edit" class="text-sm text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                        {post.title}
                      </a>
                    </div>
                    {#if post.description}
                      <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-[280px]">{post.description}</p>
                    {/if}
                  </td>
                  <td class="px-4 py-3 hidden md:table-cell">
                    <span class="text-sm text-gray-500 dark:text-gray-400">{post.category?.name || post.category || '-'}</span>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap">
                    <span class="inline-block text-xs px-2.5 py-0.5 rounded-full {post.draft ? 'bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-green-100/80 dark:bg-green-900/30 text-green-700 dark:text-green-400'}">
                      {post.draft ? '草稿' : '已发布'}
                    </span>
                  </td>
                  <td class="px-4 py-3 hidden sm:table-cell whitespace-nowrap">
                    <span class="text-sm text-gray-500 dark:text-gray-400">{getWordCount(post.content)}</span>
                    <span class="text-xs text-gray-400 dark:text-gray-500 ml-0.5">字</span>
                    <span class="text-xs text-gray-400 dark:text-gray-500 ml-1">~{getReadingTime(post.content)}分钟</span>
                  </td>
                  <td class="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
                    <span class="text-sm text-gray-500 dark:text-gray-400">{formatDate(post.pub_date || post.date || post.publishedAt || post.createdAt)}</span>
                  </td>
                  <td class="px-4 py-3 text-right whitespace-nowrap">
                    <div class="flex items-center justify-end gap-0.5 flex-nowrap">
                      <a href="#/posts/{pid}/edit" class="text-xs px-2 py-1 rounded-full text-gray-900 dark:text-gray-100 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap" title="编辑">
                        <Icon icon="mdi:pencil-outline" width="14" height="14" />
                      </a>
                      <button onclick={() => openPreview(post)} class="text-xs px-2 py-1 rounded-full text-purple-600 dark:text-purple-400 hover:bg-purple-50/80 dark:hover:bg-purple-900/30 transition-colors whitespace-nowrap" title="预览">
                        <Icon icon="mdi:eye-outline" width="14" height="14" />
                      </button>
                      <button onclick={() => handleClone(post)} class="text-xs px-2 py-1 rounded-full text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50/80 dark:hover:bg-indigo-900/30 transition-colors whitespace-nowrap" title="克隆">
                        <Icon icon="mdi:content-copy" width="14" height="14" />
                      </button>
                      <button onclick={() => handleToggleDraft(post)} class="text-xs px-2 py-1 rounded-full text-amber-600 dark:text-amber-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap" title={post.draft ? '发布' : '转草稿'}>
                        <Icon icon={post.draft ? 'mdi:publish' : 'mdi:file-document-edit-outline'} width="14" height="14" />
                      </button>
                      <button onclick={() => handleTogglePin(post)} class="text-xs px-2 py-1 rounded-full text-blue-600 dark:text-blue-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap" title={post.pin_top ? '取消置顶' : '置顶'}>
                        <Icon icon={post.pin_top ? 'mdi:pin' : 'mdi:pin-outline'} width="14" height="14" />
                      </button>
                      <button onclick={() => openPostLink(post)} class="text-xs px-2 py-1 rounded-full text-teal-600 dark:text-teal-400 hover:bg-teal-50/80 dark:hover:bg-teal-900/30 transition-colors whitespace-nowrap" title="跳转到文章">
                        <Icon icon="mdi:open-in-new" width="14" height="14" />
                      </button>
                      <button onclick={() => copyPostLink(post)} class="text-xs px-2 py-1 rounded-full text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap" title="复制链接">
                        <Icon icon="mdi:link-variant" width="14" height="14" />
                      </button>
                      <button onclick={() => deleteTarget = post} class="text-xs px-2 py-1 rounded-full text-red-600 dark:text-red-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap" title="删除">
                        <Icon icon="mdi:delete-outline" width="14" height="14" />
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      {#if postList.length > 0}
        <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">共 {totalPosts} 篇</span>
              <select onchange={(e) => { pageSize = parseInt(e.target.value); page = 1; loadData() }} class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-gray-400">
                <option value="10" selected={pageSize === 10}>10条/页</option>
                <option value="20" selected={pageSize === 20}>20条/页</option>
                <option value="50" selected={pageSize === 50}>50条/页</option>
              </select>
            </div>
            <div class="flex gap-2 shrink-0">
              <button onclick={() => { if (page > 1) { page--; loadData() } }} disabled={page <= 1} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
              <button onclick={() => { if (page < totalPages) { page++; loadData() } }} disabled={page >= totalPages} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
            </div>
          </div>
          <div class="flex items-center justify-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <span class="text-sm text-gray-400 dark:text-gray-500">第 {page} / {totalPages} 页</span>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if deleteTarget}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => deleteTarget = null}>
    <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-6 max-w-md w-full mx-4 border border-white/30 dark:border-gray-700/30" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">确认删除</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">确定要删除文章「{deleteTarget.title}」吗？此操作不可撤销。</p>
      <div class="flex justify-end gap-3">
        <button onclick={() => deleteTarget = null} class="px-5 py-2 rounded-full border border-gray-200 dark:border-gray-700 text-sm hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">取消</button>
        <button onclick={() => handleDelete(deleteTarget.id || deleteTarget._id)} class="px-5 py-2 rounded-full bg-red-500/80 backdrop-blur hover:bg-red-600/80 text-white text-sm transition-colors">删除</button>
      </div>
    </div>
  </div>
{/if}

{#if showPreview && previewPost}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => { showPreview = false; previewPost = null }}>
    <div class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] p-6 max-w-2xl w-full mx-4 border border-white/30 dark:border-gray-700/30 max-h-[80vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-start justify-between mb-4 gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 break-words">{previewPost.title}</h3>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            <span class="shrink-0">{previewPost.category?.name || previewPost.category || '未分类'}</span>
            <span class="shrink-0">·</span>
            <span class="shrink-0">{getWordCount(previewPost.content)}字</span>
            <span class="shrink-0">·</span>
            <span class="shrink-0">约{getReadingTime(previewPost.content)}分钟</span>
            <span class="shrink-0">·</span>
            <span class="px-1.5 py-0.5 rounded-full shrink-0 {previewPost.draft ? 'bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-green-100/80 dark:bg-green-900/30 text-green-700 dark:text-green-400'}">
              {previewPost.draft ? '草稿' : '已发布'}
            </span>
          </div>
        </div>
        <button onclick={() => { showPreview = false; previewPost = null }} class="p-1 rounded-full hover:bg-gray-100/80 dark:hover:bg-gray-700/50 transition-colors text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 mt-0.5">
          <Icon icon="mdi:close" width="20" height="20" />
        </button>
      </div>
      {#if previewPost.description}
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-3 italic">"{previewPost.description}"</p>
      {/if}
      <div class="flex-1 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {previewPost.content || '（无内容）'}
      </div>
      <div class="flex items-center justify-between mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <span class="text-xs text-gray-400 dark:text-gray-500">{formatDate(previewPost.pub_date || previewPost.created_at)}</span>
        <div class="flex gap-2">
          <a href="#/posts/{previewPost.id || previewPost._id}/edit" onclick={() => { showPreview = false; previewPost = null }} class="px-4 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900 text-xs font-medium hover:bg-gray-800/80 dark:hover:bg-gray-200/80 transition-colors">编辑文章</a>
          <button onclick={() => { showPreview = false; previewPost = null }} class="px-4 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">关闭</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showMoveCategoryModal}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => { showMoveCategoryModal = false; moveCategoryTarget = '' }}>
    <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-6 max-w-sm w-full mx-4 border border-white/30 dark:border-gray-700/30" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">移动到分类</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">将选中的 {selectedIds.size} 篇文章移动到：</p>
      <select
        bind:value={moveCategoryTarget}
        class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-gray-400 mb-4"
      >
        <option value="">未分类</option>
        {#each categoryList as cat}
          <option value={cat.name || cat.slug || cat.id || cat._id}>{cat.name}</option>
        {/each}
      </select>
      <div class="flex justify-end gap-3">
        <button onclick={() => { showMoveCategoryModal = false; moveCategoryTarget = '' }} class="px-5 py-2 rounded-full border border-gray-200 dark:border-gray-700 text-sm hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">取消</button>
        <button onclick={handleMoveCategory} class="px-5 py-2 rounded-full bg-indigo-500/80 hover:bg-indigo-600/80 text-white text-sm transition-colors">确认移动</button>
      </div>
    </div>
  </div>
{/if}
