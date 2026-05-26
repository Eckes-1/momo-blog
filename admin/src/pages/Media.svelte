<script>
import { media } from '../api.js'
import Icon from '@iconify/svelte'
import { addToast } from '../stores.svelte.js'
import { onSSE } from '../lib/sse.js'
import { onMount, onDestroy } from 'svelte'

let mediaList = $state([])
let loading = $state(true)
let uploading = $state(false)
let uploadProgress = $state('')
let uploadTotal = $state(0)
let uploadCurrent = $state(0)
let selectedMedia = $state(null)
let deleteTarget = $state(null)
let editAlt = $state('')
let editFilename = $state('')
let showDetail = $state(false)
let page = $state(1)
let totalPages = $state(1)
let totalItems = $state(0)
let allTotalItems = $state(0)
let pageSize = $state(20)
let imgErrors = $state(new Set())

let searchQuery = $state('')
let searchDebounce = null
let activeType = $state('all')
let sortBy = $state('date_desc')
let viewMode = $state('grid')
let gridSize = $state('md')
let dateFilter = $state('all')

let selectedIds = $state(new Set())
let selectMode = $state(false)
let lastSelectedId = $state(null)

let stats = $state(null)
let showStats = $state(false)

let dragOver = $state(false)

let replacing = $state(false)
let detailPreviewMode = $state(false)

let textPreview = $state('')
let textPreviewLoading = $state(false)

let contextMenu = $state(null)

let showLightbox = $state(false)
let lightboxIdx = $state(0)
let lightboxZoom = $state(1)
let lightboxPan = $state({ x: 0, y: 0 })
let lightboxDragging = $state(false)
let lightboxDragStart = $state({ x: 0, y: 0 })

let showUrlUpload = $state(false)
let urlUploadInput = $state('')
let urlUploading = $state(false)

let uploadPercent = $state(0)
let uploadFileName = $state('')

let imageDimensions = $state(null)

const typeFilters = [
  { key: 'all', label: '全部', icon: 'mdi:view-grid' },
  { key: 'image', label: '图片', icon: 'mdi:image' },
  { key: 'video', label: '视频', icon: 'mdi:movie-open' },
  { key: 'audio', label: '音频', icon: 'mdi:music' },
  { key: 'pdf', label: 'PDF', icon: 'mdi:file-pdf-box' },
  { key: 'document', label: '文档', icon: 'mdi:file-document' },
  { key: 'archive', label: '压缩包', icon: 'mdi:zip-box' },
  { key: 'text', label: '文本', icon: 'mdi:file-code' },
  { key: 'other', label: '其他', icon: 'mdi:file' }
]

const sortOptions = [
  { key: 'date_desc', label: '最新上传' },
  { key: 'date_asc', label: '最早上传' },
  { key: 'name_asc', label: '名称 A-Z' },
  { key: 'name_desc', label: '名称 Z-A' },
  { key: 'size_desc', label: '最大优先' },
  { key: 'size_asc', label: '最小优先' },
  { key: 'type', label: '按类型' }
]

const dateFilters = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '7天' },
  { key: 'month', label: '30天' }
]

const gridCols = {
  sm: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8',
  md: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
  lg: 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
}

function getFileType(item) {
  const mime = (item.mime_type || '').toLowerCase()
  const ext = (item.filename || '').split('.').pop().toLowerCase()
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'].includes(ext)) return 'image'
  if (mime.startsWith('video/') || ['mp4','webm','ogg','mov','avi','mkv'].includes(ext)) return 'video'
  if (mime.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a','wma'].includes(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return 'document'
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return 'archive'
  if (['txt','md','json','xml','csv','log','yaml','yml','ini','conf','js','ts','css','html','py','java','c','cpp','go','rs','sh','bat'].includes(ext)) return 'text'
  return 'other'
}

function getFileIcon(item) {
  const type = getFileType(item)
  switch (type) {
    case 'image': return 'mdi:image'
    case 'video': return 'mdi:movie-open'
    case 'audio': return 'mdi:music'
    case 'pdf': return 'mdi:file-pdf-box'
    case 'document': return 'mdi:file-document'
    case 'archive': return 'mdi:zip-box'
    case 'text': return 'mdi:file-code'
    default: return 'mdi:file'
  }
}

function getFileColor(item) {
  const type = getFileType(item)
  switch (type) {
    case 'image': return 'bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400'
    case 'video': return 'bg-purple-50 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400'
    case 'audio': return 'bg-pink-50 dark:bg-pink-900/30 text-pink-500 dark:text-pink-400'
    case 'pdf': return 'bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400'
    case 'document': return 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400'
    case 'archive': return 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
    case 'text': return 'bg-green-50 dark:bg-green-900/30 text-green-500 dark:text-green-400'
    default: return 'bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400'
  }
}

function getFileUrl(item) {
  return item.path || item.url || ''
}

function getFullUrl(item) {
  const path = getFileUrl(item)
  if (!path) return ''
  if (path.startsWith('http')) return path
  return window.location.origin + path
}

function isNewFile(item) {
  if (!item.created_at) return false
  try {
    const d = new Date(item.created_at + (item.created_at.includes('Z') || item.created_at.includes('+') ? '' : 'Z'))
    return (Date.now() - d.getTime()) < 86400000
  } catch { return false }
}

function isOfficeDoc(item) {
  const ext = (item.filename || '').split('.').pop().toLowerCase()
  return ['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp'].includes(ext)
}

function openFile(item) {
  const url = getFullUrl(item)
  if (!url) return
  if (isOfficeDoc(item)) {
    window.open('https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(url), '_blank')
  } else {
    window.open(getFileUrl(item), '_blank')
  }
}

function downloadFile(item) {
  const url = getFileUrl(item)
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = item.filename || 'download'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function handleImgError(e, itemId) {
  imgErrors.add(itemId)
  imgErrors = new Set(imgErrors)
}

async function loadTextPreview(item) {
  const type = getFileType(item)
  if (type !== 'text') { textPreview = ''; return }
  textPreviewLoading = true
  textPreview = ''
  try {
    const url = getFileUrl(item)
    if (!url) return
    const res = await fetch(url)
    if (res.ok) {
      textPreview = await res.text()
      if (textPreview.length > 5000) {
        textPreview = textPreview.slice(0, 5000) + '\n\n... (内容过长，已截断)'
      }
    }
  } catch {
    textPreview = '无法加载文件内容'
  } finally {
    textPreviewLoading = false
  }
}

async function loadData(silent = false) {
  if (!silent) loading = true
  try {
    const params = { page, pageSize }
    if (searchQuery) params.search = searchQuery
    if (activeType !== 'all') params.type = activeType
    if (sortBy !== 'date_desc') params.sort = sortBy
    if (dateFilter !== 'all') params.date = dateFilter
    const data = await media.list(params)
    mediaList = data.media || data.data || []
    const pag = data.pagination || {}
    totalPages = pag.totalPages || Math.ceil((pag.total || mediaList.length) / pageSize) || 1
    totalItems = pag.total || 0
    if (activeType === 'all' && !searchQuery && dateFilter === 'all') {
      allTotalItems = totalItems
    }
  } catch (e) {
    if (!silent) addToast('加载媒体失败', 'error')
  } finally {
    if (!silent) loading = false
  }
}

async function loadStats() {
  try {
    stats = await media.stats()
  } catch {
    stats = null
  }
}

onMount(() => {
  loadData()
  loadStats()
  const off = onSSE((data) => {
    if (data.resources.includes('media')) {
      loadData(true)
      loadStats()
    }
  })
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('paste', handlePaste)
  return () => {
    off()
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('click', closeContextMenu)
    window.removeEventListener('paste', handlePaste)
  }
})

onDestroy(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('paste', handlePaste)
})

function handleKeydown(e) {
  if (e.key === 'Escape') {
    if (showLightbox) { closeLightbox(); return }
    if (contextMenu) { closeContextMenu(); return }
    if (showDetail) { closeDetail(); return }
    if (deleteTarget) { deleteTarget = null; return }
    if (selectMode) { exitSelectMode(); return }
    if (showStats) { showStats = false; return }
  }
  if (showLightbox) {
    if (e.key === 'ArrowLeft') { navigateLightbox(-1); return }
    if (e.key === 'ArrowRight') { navigateLightbox(1); return }
    if (e.key === '+' || e.key === '=') { lightboxZoom = Math.min(5, lightboxZoom + 0.25); return }
    if (e.key === '-') { lightboxZoom = Math.max(0.25, lightboxZoom - 0.25); return }
    if (e.key === '0') { lightboxZoom = 1; lightboxPan = { x: 0, y: 0 }; return }
    return
  }
  if (e.key === 'Delete' && showDetail && selectedMedia && !e.target.closest('input, textarea')) {
    deleteTarget = selectedMedia
  }
  if (e.key === 'a' && (e.ctrlKey || e.metaKey) && selectMode) {
    e.preventDefault()
    toggleSelectAll()
  }
  if (showDetail && selectedMedia) {
    if (e.key === 'ArrowLeft') { navigateDetail(-1); return }
    if (e.key === 'ArrowRight') { navigateDetail(1); return }
  }
}

function handleSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    page = 1
    loadData()
  }, 300)
}

function handleTypeChange(type) {
  activeType = type
  page = 1
  selectedIds = new Set()
  loadData()
}

function handleSortChange(e) {
  sortBy = e.target.value
  page = 1
  loadData()
}

function handleDateFilterChange(df) {
  dateFilter = df
  page = 1
  loadData()
}

function handlePageSizeChange(e) {
  pageSize = Number(e.target.value)
  page = 1
  loadData()
}

async function handleUpload(e) {
  const files = e.target?.files || e.dataTransfer?.files
  if (!files || files.length === 0) return
  await processUploadFiles(files)
  if (e.target && e.target.tagName === 'INPUT') {
    e.target.value = ''
  }
}

async function handleUrlUpload() {
  if (!urlUploadInput.trim()) return
  urlUploading = true
  try {
    const res = await fetch(urlUploadInput.trim())
    if (!res.ok) throw new Error('无法获取文件')
    const blob = await res.blob()
    const urlObj = new URL(urlUploadInput.trim())
    const filename = urlObj.pathname.split('/').pop() || 'download'
    const file = new File([blob], filename, { type: blob.type })
    await media.upload(file)
    addToast('URL上传成功', 'success')
    showUrlUpload = false
    urlUploadInput = ''
    loadData()
    loadStats()
  } catch (e) {
    addToast(e.message || 'URL上传失败', 'error')
  } finally {
    urlUploading = false
  }
}

function handleDragOver(e) {
  e.preventDefault()
  dragOver = true
}

function handleDragLeave(e) {
  e.preventDefault()
  dragOver = false
}

function handleDrop(e) {
  e.preventDefault()
  dragOver = false
  handleUpload(e)
}

function openDetail(item) {
  selectedMedia = item
  editAlt = item.alt_text || item.alt || ''
  editFilename = item.filename || ''
  showDetail = true
  detailPreviewMode = false
  loadTextPreview(item)
  loadImageDimensions(item)
}

function closeDetail() {
  showDetail = false
  selectedMedia = null
  textPreview = ''
}

function navigateDetail(dir) {
  if (!selectedMedia) return
  const idx = mediaList.findIndex(m => (m.id || m._id) === (selectedMedia.id || selectedMedia._id))
  if (idx < 0) return
  const next = idx + dir
  if (next < 0 || next >= mediaList.length) return
  openDetail(mediaList[next])
}

function openLightbox(idx) {
  lightboxIdx = idx
  lightboxZoom = 1
  lightboxPan = { x: 0, y: 0 }
  showLightbox = true
}

function closeLightbox() {
  showLightbox = false
  lightboxZoom = 1
  lightboxPan = { x: 0, y: 0 }
}

function navigateLightbox(dir) {
  const next = lightboxIdx + dir
  if (next < 0 || next >= mediaList.length) return
  lightboxIdx = next
  lightboxZoom = 1
  lightboxPan = { x: 0, y: 0 }
}

function handleLightboxWheel(e) {
  e.preventDefault()
  if (e.deltaY < 0) {
    lightboxZoom = Math.min(5, lightboxZoom + 0.15)
  } else {
    lightboxZoom = Math.max(0.25, lightboxZoom - 0.15)
  }
}

function handleLightboxMouseDown(e) {
  if (lightboxZoom <= 1) return
  lightboxDragging = true
  lightboxDragStart = { x: e.clientX - lightboxPan.x, y: e.clientY - lightboxPan.y }
}

function handleLightboxMouseMove(e) {
  if (!lightboxDragging) return
  lightboxPan = { x: e.clientX - lightboxDragStart.x, y: e.clientY - lightboxDragStart.y }
}

function handleLightboxMouseUp() {
  lightboxDragging = false
}

async function handleSaveDetail() {
  if (!selectedMedia) return
  try {
    const data = {}
    if (editAlt !== (selectedMedia.alt_text || '')) data.alt_text = editAlt
    if (editFilename !== selectedMedia.filename) data.filename = editFilename
    if (Object.keys(data).length > 0) {
      await media.update(selectedMedia.id || selectedMedia._id, data)
      addToast('保存成功', 'success')
      loadData()
      closeDetail()
    }
  } catch (e) {
    addToast(e.message || '保存失败', 'error')
  }
}

async function handleReplaceFile(e) {
  const file = e.target?.files?.[0]
  if (!file || !selectedMedia) return
  replacing = true
  try {
    await media.replace(selectedMedia.id || selectedMedia._id, file)
    addToast('文件替换成功', 'success')
    loadData()
    closeDetail()
  } catch (e) {
    addToast(e.message || '替换失败', 'error')
  } finally {
    replacing = false
    e.target.value = ''
  }
}

async function handleDelete(id) {
  try {
    await media.delete(id)
    addToast('删除成功', 'success')
    deleteTarget = null
    if (selectedMedia?.id === id || selectedMedia?._id === id) closeDetail()
    loadData()
    loadStats()
  } catch (e) {
    addToast(e.message || '删除失败', 'error')
  }
}

async function handleBatchDelete() {
  if (selectedIds.size === 0) return
  try {
    const result = await media.batchDelete([...selectedIds])
    addToast(result.message || '批量删除成功', 'success')
    selectedIds = new Set()
    selectMode = false
    loadData()
    loadStats()
  } catch (e) {
    addToast(e.message || '批量删除失败', 'error')
  }
}

async function handleBatchDownload() {
  if (selectedIds.size === 0) return
  const items = mediaList.filter(m => selectedIds.has(m.id || m._id))
  for (const item of items) {
    downloadFile(item)
    await new Promise(r => setTimeout(r, 300))
  }
  addToast(`已下载 ${items.length} 个文件`, 'success')
}

function toggleSelect(id) {
  const newSet = new Set(selectedIds)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  lastSelectedId = id
  selectedIds = newSet
}

function handleSelectClick(e, item) {
  const id = item.id || item._id
  if (e.shiftKey && lastSelectedId) {
    const ids = mediaList.map(m => m.id || m._id)
    const from = ids.indexOf(lastSelectedId)
    const to = ids.indexOf(id)
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      const newSet = new Set(selectedIds)
      for (let i = start; i <= end; i++) {
        newSet.add(ids[i])
      }
      selectedIds = newSet
    }
  } else {
    toggleSelect(id)
  }
}

function toggleSelectAll() {
  if (selectedIds.size === mediaList.length) {
    selectedIds = new Set()
  } else {
    selectedIds = new Set(mediaList.map(m => m.id || m._id))
  }
}

function exitSelectMode() {
  selectMode = false
  selectedIds = new Set()
  lastSelectedId = null
}

function copyToClipboard(text, label = '已复制') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      addToast(label, 'success')
    }).catch(() => {
      addToast('复制失败', 'error')
    })
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      addToast(label, 'success')
    } catch {
      addToast('复制失败', 'error')
    }
    document.body.removeChild(textarea)
  }
}

function copyUrl(url) {
  const fullUrl = url.startsWith('http') ? url : window.location.origin + url
  copyToClipboard(fullUrl, '已复制链接')
}

function copyMarkdown(item) {
  const url = getFullUrl(item)
  const alt = item.alt_text || item.filename || ''
  const type = getFileType(item)
  let md = type === 'image' ? `![${alt}](${url})` : `[${item.filename}](${url})`
  copyToClipboard(md, '已复制 Markdown')
}

function copyHtml(item) {
  const url = getFullUrl(item)
  const alt = item.alt_text || item.filename || ''
  const type = getFileType(item)
  let html = ''
  if (type === 'image') html = `<img src="${url}" alt="${alt}" />`
  else if (type === 'video') html = `<video src="${url}" controls></video>`
  else if (type === 'audio') html = `<audio src="${url}" controls></audio>`
  else html = `<a href="${url}">${item.filename}</a>`
  copyToClipboard(html, '已复制 HTML')
}

function formatSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'))
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

function handleContextMenu(e, item) {
  e.preventDefault()
  e.stopPropagation()
  const x = Math.min(e.clientX, window.innerWidth - 180)
  const y = Math.min(e.clientY, window.innerHeight - 260)
  contextMenu = { x, y, item }
}

function closeContextMenu() {
  contextMenu = null
}

function handlePaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  const files = []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        const ext = file.type.split('/')[1] || 'png'
        const namedFile = new File([file], `paste-${Date.now()}.${ext}`, { type: file.type })
        files.push(namedFile)
      }
    }
  }
  if (files.length > 0) {
    e.preventDefault()
    processUploadFiles(files)
  }
}

async function processUploadFiles(files) {
  const fileArray = Array.from(files)
  const oversized = fileArray.filter(f => f.size > 10 * 1024 * 1024)
  if (oversized.length > 0) {
    const names = oversized.map(f => f.name).join(', ')
    addToast(`大文件警告: ${names} 超过10MB，上传可能较慢`, 'info')
  }

  const duplicateNames = fileArray.filter(f =>
    mediaList.some(m => m.filename === f.name)
  )
  if (duplicateNames.length > 0) {
    const names = duplicateNames.map(f => f.name).join(', ')
    addToast(`存在同名文件: ${names}，将自动重命名`, 'warning')
  }

  uploading = true
  uploadTotal = fileArray.length
  try {
    for (let i = 0; i < fileArray.length; i++) {
      uploadCurrent = i + 1
      uploadFileName = fileArray[i].name
      uploadPercent = 0
      uploadProgress = fileArray.length > 1 ? `(${i + 1}/${fileArray.length})` : ''
      await media.upload(fileArray[i], (loaded, total) => {
        uploadPercent = Math.round((loaded / total) * 100)
      })
    }
    addToast('上传成功', 'success')
    loadData()
    loadStats()
  } catch (e) {
    addToast(e.message || '上传失败', 'error')
  } finally {
    uploading = false
    uploadProgress = ''
    uploadPercent = 0
    uploadFileName = ''
    dragOver = false
  }
}

function loadImageDimensions(item) {
  imageDimensions = null
  const type = getFileType(item)
  if (type !== 'image') return
  const url = getFileUrl(item)
  if (!url) return
  const img = new Image()
  img.onload = () => {
    imageDimensions = { width: img.naturalWidth, height: img.naturalHeight }
  }
  img.onerror = () => {
    imageDimensions = null
  }
  img.src = url
}

function batchCopyUrls() {
  const items = mediaList.filter(m => selectedIds.has(m.id || m._id))
  const urls = items.map(m => {
    const url = getFullUrl(m)
    return url
  }).join('\n')
  copyToClipboard(urls, `已复制 ${items.length} 个链接`)
}

function batchCopyMarkdown() {
  const items = mediaList.filter(m => selectedIds.has(m.id || m._id))
  const md = items.map(m => {
    const url = getFullUrl(m)
    const type = getFileType(m)
    return type === 'image' ? `![${m.filename}](${url})` : `[${m.filename}](${url})`
  }).join('\n')
  copyToClipboard(md, `已复制 ${items.length} 个 Markdown`)
}

function batchCopyHtml() {
  const items = mediaList.filter(m => selectedIds.has(m.id || m._id))
  const html = items.map(m => {
    const url = getFullUrl(m)
    const type = getFileType(m)
    if (type === 'image') return `<img src="${url}" alt="${m.filename}" />`
    if (type === 'video') return `<video src="${url}" controls></video>`
    if (type === 'audio') return `<audio src="${url}" controls></audio>`
    return `<a href="${url}">${m.filename}</a>`
  }).join('\n')
  copyToClipboard(html, `已复制 ${items.length} 个 HTML`)
}

function handleStatTypeClick(type) {
  activeType = type
  page = 1
  selectedIds = new Set()
  loadData()
}
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between gap-2 min-w-0">
    <div class="flex items-center gap-2 min-w-0">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 shrink-0">媒体库</h2>
      {#if totalItems > 0}
        <span class="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-full shrink-0">{totalItems}</span>
      {/if}
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      {#if !selectMode}
        <button
          onclick={() => { selectMode = true; showStats = false }}
          class="p-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors shrink-0"
          title="批量操作"
        >
          <Icon icon="mdi:checkbox-multiple-marked-outline" width="15" height="15" class="text-gray-500 dark:text-gray-400" />
        </button>
      {/if}
      <button
        onclick={() => showUrlUpload = !showUrlUpload}
        class="p-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors shrink-0"
        title="URL上传"
      >
        <Icon icon="mdi:link-variant" width="15" height="15" class="text-gray-500 dark:text-gray-400" />
      </button>
      <button
        onclick={() => { showStats = !showStats; if (showStats) loadStats() }}
        class="p-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors shrink-0"
        title="存储统计"
      >
        <Icon icon="mdi:chart-pie" width="15" height="15" class="text-gray-500 dark:text-gray-400" />
      </button>
      <label class="px-3 py-1 rounded-full bg-gray-900/80 dark:bg-gray-100/80 hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-xs font-medium transition-colors cursor-pointer shrink-0">
        {uploading ? (uploadProgress || '...') : '+ 上传'}
        <input type="file" multiple onchange={handleUpload} class="hidden" />
      </label>
    </div>
  </div>

  {#if showUrlUpload}
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
      <div class="flex gap-2">
        <input
          type="url"
          bind:value={urlUploadInput}
          placeholder="输入文件URL地址..."
          class="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 focus:border-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 min-w-0"
          onkeydown={(e) => { if (e.key === 'Enter') handleUrlUpload() }}
        />
        <button
          onclick={handleUrlUpload}
          disabled={urlUploading || !urlUploadInput.trim()}
          class="px-3 py-1.5 rounded-lg bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900 text-xs font-medium hover:bg-gray-800/80 dark:hover:bg-gray-200/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {urlUploading ? '上传中...' : '上传'}
        </button>
        <button
          onclick={() => { showUrlUpload = false; urlUploadInput = '' }}
          class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
        >
          <Icon icon="mdi:close" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
        </button>
      </div>
      <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">输入远程文件URL，服务端将下载并保存到媒体库</p>
    </div>
  {/if}

  {#if uploading}
    <div class="bg-blue-50/60 dark:bg-blue-900/20 rounded-lg px-3 py-1.5 flex items-center gap-2">
      <div class="flex-1 bg-blue-100 dark:bg-blue-900/40 rounded-full h-1.5 overflow-hidden">
        <div class="h-full bg-blue-500 rounded-full transition-all" style="width: {uploadPercent}%"></div>
      </div>
      <span class="text-xs text-blue-600 dark:text-blue-400 shrink-0">{uploadPercent}%</span>
      {#if uploadTotal > 1}
        <span class="text-xs text-blue-500 dark:text-blue-500 shrink-0">{uploadCurrent}/{uploadTotal}</span>
      {/if}
      {#if uploadFileName}
        <span class="text-xs text-blue-400 dark:text-blue-500 truncate max-w-[120px]">{uploadFileName}</span>
      {/if}
    </div>
  {/if}

  {#if selectMode}
    <div class="flex items-center gap-1.5 flex-wrap">
      {#if selectedIds.size > 0}
        <button
          onclick={handleBatchDelete}
          class="px-2.5 py-1 rounded-full bg-red-500/80 hover:bg-red-600/80 text-white text-xs transition-colors flex items-center gap-1 shrink-0"
        >
          <Icon icon="mdi:delete-outline" width="13" height="13" />
          删除({selectedIds.size})
        </button>
        <button
          onclick={handleBatchDownload}
          class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 text-xs hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors flex items-center gap-1 shrink-0"
        >
          <Icon icon="mdi:download" width="13" height="13" />
          下载({selectedIds.size})
        </button>
        <div class="relative group">
          <button
            class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 text-xs hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors flex items-center gap-1 shrink-0"
          >
            <Icon icon="mdi:content-copy" width="13" height="13" />
            复制({selectedIds.size})
            <Icon icon="mdi:chevron-down" width="12" height="12" />
          </button>
          <div class="absolute left-0 top-full mt-1 z-20 bg-white/95 dark:bg-gray-800/95 backdrop-blur-2xl rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[140px] hidden group-hover:block">
            <button onclick={batchCopyUrls} class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <Icon icon="mdi:link-variant" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
              复制链接
            </button>
            <button onclick={batchCopyMarkdown} class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <Icon icon="mdi:language-markdown" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
              复制 Markdown
            </button>
            <button onclick={batchCopyHtml} class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors">
              <Icon icon="mdi:code-tags" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
              复制 HTML
            </button>
          </div>
        </div>
      {/if}
      <button
        onclick={toggleSelectAll}
        class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 text-xs hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors flex items-center gap-1 shrink-0"
      >
        <Icon icon={selectedIds.size === mediaList.length && mediaList.length > 0 ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'} width="13" height="13" />
        {selectedIds.size === mediaList.length && mediaList.length > 0 ? '取消全选' : '全选'}
      </button>
      <span class="text-xs text-gray-400 dark:text-gray-500">已选 {selectedIds.size} 项 · Shift+点击范围选择 · Ctrl+V粘贴上传</span>
      <button onclick={exitSelectMode} class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 text-xs hover:bg-white/80 dark:hover:bg-gray-700/80 transition-colors shrink-0 ml-auto">
        退出选择
      </button>
    </div>
  {/if}

  {#if showStats && stats}
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">存储统计</h3>
        <button onclick={() => showStats = false} class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400">
          <Icon icon="mdi:close" width="16" height="16" />
        </button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div class="bg-blue-50/60 dark:bg-blue-900/20 rounded-xl p-3 text-center">
          <p class="text-lg font-bold text-blue-600 dark:text-blue-400">{stats.totalFiles}</p>
          <p class="text-xs text-blue-400">文件总数</p>
        </div>
        <div class="bg-purple-50/60 dark:bg-purple-900/20 rounded-xl p-3 text-center">
          <p class="text-lg font-bold text-purple-600 dark:text-purple-400">{formatSize(stats.totalSize)}</p>
          <p class="text-xs text-purple-400">总大小</p>
        </div>
        <div class="bg-green-50/60 dark:bg-green-900/20 rounded-xl p-3 text-center">
          <p class="text-lg font-bold text-green-600 dark:text-green-400">{stats.byType.image?.count || 0}</p>
          <p class="text-xs text-green-400">图片</p>
        </div>
        <div class="bg-pink-50/60 dark:bg-pink-900/20 rounded-xl p-3 text-center">
          <p class="text-lg font-bold text-pink-600 dark:text-pink-400">{(stats.byType.video?.count || 0) + (stats.byType.audio?.count || 0)}</p>
          <p class="text-xs text-pink-400">音视频</p>
        </div>
      </div>
      {#if stats.totalSize > 0}
        <div class="mb-3">
          <div class="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
            <span>存储分布</span>
            <span>{formatSize(stats.totalSize)}</span>
          </div>
          <div class="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700/50">
            {#each Object.entries(stats.byType) as [type, info], i}
              {@const pct = stats.totalSize > 0 ? (info.size / stats.totalSize) * 100 : 0}
              {#if pct > 0}
                <div
                  class="h-full transition-all {type === 'image' ? 'bg-blue-400' : type === 'video' ? 'bg-purple-400' : type === 'audio' ? 'bg-pink-400' : type === 'pdf' ? 'bg-red-400' : type === 'document' ? 'bg-indigo-400' : type === 'archive' ? 'bg-amber-400' : type === 'text' ? 'bg-green-400' : 'bg-gray-400'}"
                  style="width: {pct}%"
                  title="{type}: {formatSize(info.size)}"
                ></div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
      {#if Object.keys(stats.byType).length > 0}
        <div class="space-y-1.5">
          {#each Object.entries(stats.byType) as [type, info]}
            <div
              class="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded-lg px-1 py-0.5 -mx-1 transition-colors"
              onclick={() => handleStatTypeClick(type)}
              title="点击筛选{type}类型"
            >
              <span class="w-14 text-gray-500 dark:text-gray-400 capitalize">{type}</span>
              <div class="flex-1 bg-gray-100 dark:bg-gray-700/50 rounded-full h-2 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  class:bg-blue-400={type === 'image'}
                  class:bg-purple-400={type === 'video'}
                  class:bg-pink-400={type === 'audio'}
                  class:bg-red-400={type === 'pdf'}
                  class:bg-indigo-400={type === 'document'}
                  class:bg-amber-400={type === 'archive'}
                  class:bg-green-400={type === 'text'}
                  class:bg-gray-400={type === 'other'}
                  style="width: {stats.totalSize > 0 ? Math.max(2, (info.size / stats.totalSize) * 100) : 0}%"
                ></div>
              </div>
              <span class="w-16 text-right text-gray-400 dark:text-gray-500">{formatSize(info.size)}</span>
              <span class="w-10 text-right text-gray-400 dark:text-gray-500">{info.count}个</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex gap-2 items-center">
    <div class="relative flex-1 min-w-0">
      <Icon icon="mdi:magnify" width="16" height="16" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
      <input
        type="text"
        placeholder="搜索..."
        bind:value={searchQuery}
        oninput={handleSearchInput}
        class="w-full pl-8 pr-8 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 focus:border-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
      />
      {#if searchQuery}
        <button
          onclick={() => { searchQuery = ''; page = 1; loadData() }}
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
        >
          <Icon icon="mdi:close-circle" width="14" height="14" />
        </button>
      {/if}
    </div>
    <select
      bind:value={sortBy}
      onchange={handleSortChange}
      class="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 text-xs outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 shrink-0"
    >
      {#each sortOptions as opt}
        <option value={opt.key}>{opt.label}</option>
      {/each}
    </select>
    <select
      value={pageSize}
      onchange={handlePageSizeChange}
      class="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 text-xs outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 shrink-0"
      title="每页数量"
    >
      <option value={20}>20条</option>
      <option value={40}>40条</option>
      <option value={60}>60条</option>
    </select>
    <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
      <button
        onclick={() => viewMode = 'grid'}
        class="p-1.5 {viewMode === 'grid' ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-gray-700/70'} transition-colors"
      >
        <Icon icon="mdi:view-grid" width="14" height="14" />
      </button>
      <button
        onclick={() => viewMode = 'list'}
        class="p-1.5 {viewMode === 'list' ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-gray-700/70'} transition-colors"
      >
        <Icon icon="mdi:view-list" width="14" height="14" />
      </button>
    </div>
    {#if viewMode === 'grid'}
      <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
        <button onclick={() => gridSize = 'sm'} class="p-1.5 {gridSize === 'sm' ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400'} transition-colors" title="小图标">
          <Icon icon="mdi:view-grid-compact" width="14" height="14" />
        </button>
        <button onclick={() => gridSize = 'md'} class="p-1.5 {gridSize === 'md' ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400'} transition-colors" title="中图标">
          <Icon icon="mdi:view-grid" width="14" height="14" />
        </button>
        <button onclick={() => gridSize = 'lg'} class="p-1.5 {gridSize === 'lg' ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400'} transition-colors" title="大图标">
          <Icon icon="mdi:view-grid-plus" width="14" height="14" />
        </button>
      </div>
    {/if}
  </div>

  <div class="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1" style="scrollbar-width: none; -ms-overflow-style: none;">
    {#each typeFilters as tf}
      {@const count = tf.key === 'all' ? allTotalItems : (stats?.byType?.[tf.key]?.count || 0)}
      <button
        onclick={() => handleTypeChange(tf.key)}
        class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 shrink-0 {activeType === tf.key ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-white/70 dark:hover:bg-gray-700/70'}"
      >
        <Icon icon={tf.icon} width="13" height="13" />
        {tf.label}
        {#if count > 0}
          <span class="opacity-60">{count}</span>
        {/if}
      </button>
    {/each}
    <div class="border-l border-gray-200 dark:border-gray-700 mx-1 shrink-0"></div>
    {#each dateFilters as df}
      <button
        onclick={() => handleDateFilterChange(df.key)}
        class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors shrink-0 {dateFilter === df.key ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'bg-white/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-white/70 dark:hover:bg-gray-700/70'}"
      >
        {df.label}
      </button>
    {/each}
  </div>

  <label
    class="block border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer {dragOver ? 'border-blue-400 dark:border-blue-500 bg-blue-50/30 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 bg-white/30 dark:bg-gray-800/30'} hover:border-gray-400/50 dark:hover:border-gray-500/50"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <input type="file" multiple onchange={handleUpload} class="hidden" />
    <div class="{dragOver ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}">
      <Icon icon="mdi:cloud-upload-outline" width="28" height="28" class="mx-auto mb-1" />
      <p class="text-xs">{dragOver ? '松开以上传' : '点击或拖拽文件到此处上传'}</p>
      <p class="text-[10px] mt-0.5 opacity-60">支持 Ctrl+V 粘贴图片</p>
    </div>
  </label>

  {#if loading}
    <div class="flex items-center justify-center h-32">
      <div class="text-gray-400 dark:text-gray-500">加载中...</div>
    </div>
  {:else if mediaList.length === 0}
    <div class="text-center py-12 text-gray-400 dark:text-gray-500">
      <Icon icon="mdi:folder-open-outline" width="48" height="48" class="mx-auto mb-2 opacity-50" />
      <p>{searchQuery || activeType !== 'all' || dateFilter !== 'all' ? '没有找到匹配的文件' : '暂无媒体文件'}</p>
    </div>
  {:else}
    {#if viewMode === 'grid'}
      <div class="grid {gridCols[gridSize]} gap-3">
        {#each mediaList as item, idx (item.id || item._id)}
          {@const fileType = getFileType(item)}
          {@const fileUrl = getFileUrl(item)}
          {@const hasError = imgErrors.has(item.id || item._id)}
          {@const isSelected = selectedIds.has(item.id || item._id)}
          {@const isNew = isNewFile(item)}
          <div
            class="group relative bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-xl border overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-shadow {isSelected ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-700'}"
            onclick={(e) => selectMode ? handleSelectClick(e, item) : openDetail(item)}
            oncontextmenu={(e) => handleContextMenu(e, item)}
            ondblclick={() => { if (!selectMode && fileType === 'image') openLightbox(idx) }}
          >
            {#if selectMode}
              <div class="absolute top-1.5 left-1.5 z-10">
                <div class="w-4 h-4 rounded border-2 flex items-center justify-center {isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white/80 dark:bg-gray-800/80 border-gray-300 dark:border-gray-600'}">
                  {#if isSelected}
                    <Icon icon="mdi:check" width="10" height="10" class="text-white" />
                  {/if}
                </div>
              </div>
            {/if}
            {#if isNew && !selectMode}
              <div class="absolute top-1.5 left-1.5 z-10">
                <span class="px-1.5 py-0.5 rounded-full bg-green-500 text-white text-[9px] font-bold">NEW</span>
              </div>
            {/if}
            <div class="aspect-square bg-gray-100/50 dark:bg-gray-700/30 flex items-center justify-center overflow-hidden">
              {#if fileType === 'image' && !hasError}
                <img src={fileUrl} alt={item.alt_text || item.alt || item.filename} class="w-full h-full object-cover" loading="lazy" onerror={(e) => handleImgError(e, item.id || item._id)} />
              {:else if fileType === 'image' && hasError}
                <div class="flex flex-col items-center justify-center gap-1.5 w-full h-full bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400">
                  <Icon icon="mdi:image-broken" width="36" height="36" />
                  <span class="text-[10px] font-medium">{(item.filename || '').split('.').pop()?.toUpperCase()}</span>
                </div>
              {:else if fileType === 'video'}
                <div class="w-full h-full relative bg-gray-900/5">
                  <video src={fileUrl} class="w-full h-full object-cover" preload="metadata" muted></video>
                  <div class="absolute inset-0 flex items-center justify-center bg-black/10">
                    <div class="w-8 h-8 rounded-full bg-white/90 dark:bg-gray-800/90 flex items-center justify-center shadow-lg">
                      <Icon icon="mdi:play" width="16" height="16" class="text-gray-700 dark:text-gray-300 ml-0.5" />
                    </div>
                  </div>
                </div>
              {:else}
                <div class="flex flex-col items-center justify-center gap-1.5 w-full h-full {getFileColor(item)}">
                  <Icon icon={getFileIcon(item)} width="36" height="36" />
                  <span class="text-[10px] font-medium">{fileType === 'pdf' ? 'PDF' : (item.filename || '').split('.').pop()?.toUpperCase() || 'FILE'}</span>
                </div>
              {/if}
            </div>
            <div class="p-1.5">
              <p class="text-[11px] text-gray-600 dark:text-gray-400 truncate">{item.filename || '未命名'}</p>
              <p class="text-[10px] text-gray-400 dark:text-gray-500">{formatSize(item.size)}</p>
            </div>
            {#if !selectMode}
              <div class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                {#if fileType === 'image'}
                  <button onclick={(e) => { e.stopPropagation(); openLightbox(idx) }} class="p-1 rounded-full bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600 transition-colors" title="全屏查看">
                    <Icon icon="mdi:magnify-plus" width="12" height="12" class="text-gray-600 dark:text-gray-400" />
                  </button>
                {/if}
                <button onclick={(e) => { e.stopPropagation(); openDetail(item) }} class="p-1 rounded-full bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600 transition-colors" title="编辑">
                  <Icon icon="mdi:pencil" width="12" height="12" class="text-gray-600 dark:text-gray-400" />
                </button>
                <button onclick={(e) => { e.stopPropagation(); downloadFile(item) }} class="p-1 rounded-full bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600 transition-colors" title="下载">
                  <Icon icon="mdi:download" width="12" height="12" class="text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto shadow-sm">
        <table class="w-full min-w-[480px]">
          <thead>
            <tr class="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
              <th class="text-left py-2 px-2.5 font-medium">文件</th>
              <th class="text-left py-2 px-2.5 font-medium hidden sm:table-cell">类型</th>
              <th class="text-left py-2 px-2.5 font-medium">大小</th>
              <th class="text-left py-2 px-2.5 font-medium hidden md:table-cell">时间</th>
              <th class="text-right py-2 px-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {#each mediaList as item, idx (item.id || item._id)}
              {@const fileType = getFileType(item)}
              {@const fileUrl = getFileUrl(item)}
              {@const isSelected = selectedIds.has(item.id || item._id)}
              {@const isNew = isNewFile(item)}
              <tr
                class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors {isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}"
                onclick={(e) => selectMode ? handleSelectClick(e, item) : openDetail(item)}
                oncontextmenu={(e) => handleContextMenu(e, item)}
                ondblclick={() => { if (!selectMode && fileType === 'image') openLightbox(idx) }}
              >
                <td class="py-2 px-2.5">
                  <div class="flex items-center gap-2 min-w-0">
                    {#if selectMode}
                      <div class="w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 {isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}">
                        {#if isSelected}<Icon icon="mdi:check" width="9" height="9" class="text-white" />{/if}
                      </div>
                    {/if}
                    <div class="w-7 h-7 rounded-lg {getFileColor(item)} flex items-center justify-center shrink-0">
                      <Icon icon={getFileIcon(item)} width="15" height="15" />
                    </div>
                    <span class="text-xs text-gray-700 dark:text-gray-300 truncate">{item.filename || '未命名'}</span>
                    {#if isNew}
                      <span class="px-1 py-0.5 rounded-full bg-green-500 text-white text-[9px] font-bold shrink-0">NEW</span>
                    {/if}
                  </div>
                </td>
                <td class="py-2 px-2.5 text-xs text-gray-400 dark:text-gray-500 capitalize hidden sm:table-cell">{fileType}</td>
                <td class="py-2 px-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatSize(item.size)}</td>
                <td class="py-2 px-2.5 text-xs text-gray-400 dark:text-gray-500 hidden md:table-cell whitespace-nowrap">{formatDate(item.created_at)}</td>
                <td class="py-2 px-2.5">
                  <div class="flex items-center justify-end gap-0.5">
                    {#if fileType === 'image'}
                      <button onclick={(e) => { e.stopPropagation(); openLightbox(idx) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="全屏查看">
                        <Icon icon="mdi:magnify-plus" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                      </button>
                    {/if}
                    <button onclick={(e) => { e.stopPropagation(); openFile(item) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="打开">
                      <Icon icon="mdi:open-in-new" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); openDetail(item) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="编辑">
                      <Icon icon="mdi:pencil" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); downloadFile(item) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="下载">
                      <Icon icon="mdi:download" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); copyUrl(fileUrl) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="复制链接">
                      <Icon icon="mdi:content-copy" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); copyMarkdown(item) }} class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0" title="Markdown">
                      <Icon icon="mdi:language-markdown" width="13" height="13" class="text-gray-400 dark:text-gray-500" />
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if totalPages > 1}
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-500 dark:text-gray-400">第 {page}/{totalPages} 页</span>
        <div class="flex gap-1.5">
          <button onclick={() => { if (page > 1) { page--; loadData(); window.scrollTo({ top: 0, behavior: 'smooth' }) } }} disabled={page <= 1} class="px-3 py-1 rounded-lg text-xs border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white/70 dark:hover:bg-gray-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
          <button onclick={() => { if (page < totalPages) { page++; loadData(); window.scrollTo({ top: 0, behavior: 'smooth' }) } }} disabled={page >= totalPages} class="px-3 py-1 rounded-lg text-xs border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white/70 dark:hover:bg-gray-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if showLightbox && mediaList[lightboxIdx]}
  {@const lbItem = mediaList[lightboxIdx]}
  {@const lbUrl = getFileUrl(lbItem)}
  <div
    class="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center select-none"
    onclick={closeLightbox}
    onwheel={handleLightboxWheel}
  >
    <div class="absolute top-3 left-3 z-10 flex items-center gap-2">
      <span class="text-xs text-white/60">{lightboxIdx + 1}/{mediaList.length}</span>
      <span class="text-xs text-white/40">{lbItem.filename}</span>
    </div>
    <div class="absolute top-3 right-3 z-10 flex items-center gap-1.5">
      <button onclick={(e) => { e.stopPropagation(); lightboxZoom = 1; lightboxPan = { x: 0, y: 0 } }} class="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/70" title="重置缩放 (0)">
        <Icon icon="mdi:magnify" width="16" height="16" />
      </button>
      <span class="text-xs text-white/50 min-w-[3rem] text-center">{Math.round(lightboxZoom * 100)}%</span>
      <button onclick={(e) => { e.stopPropagation(); downloadFile(lbItem) }} class="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/70" title="下载">
        <Icon icon="mdi:download" width="16" height="16" />
      </button>
      <button onclick={closeLightbox} class="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/70" title="关闭 (Esc)">
        <Icon icon="mdi:close" width="16" height="16" />
      </button>
    </div>
    <div
      class="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
      onclick={(e) => e.stopPropagation()}
      onmousedown={handleLightboxMouseDown}
      onmousemove={handleLightboxMouseMove}
      onmouseup={handleLightboxMouseUp}
      onmouseleave={handleLightboxMouseUp}
    >
      <img
        src={lbUrl}
        alt={lbItem.filename}
        class="max-w-full max-h-[85vh] object-contain transition-transform"
        style="transform: scale({lightboxZoom}) translate({lightboxPan.x / lightboxZoom}px, {lightboxPan.y / lightboxZoom}px); cursor: {lightboxZoom > 1 ? 'grab' : 'zoom-in'}"
        draggable="false"
      />
    </div>
    {#if lightboxIdx > 0}
      <button onclick={(e) => { e.stopPropagation(); navigateLightbox(-1) }} class="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/70" title="上一张 (←)">
        <Icon icon="mdi:chevron-left" width="24" height="24" />
      </button>
    {/if}
    {#if lightboxIdx < mediaList.length - 1}
      <button onclick={(e) => { e.stopPropagation(); navigateLightbox(1) }} class="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/70" title="下一张 (→)">
        <Icon icon="mdi:chevron-right" width="24" height="24" />
      </button>
    {/if}
  </div>
{/if}

{#if showDetail && selectedMedia}
  {@const detailType = getFileType(selectedMedia)}
  {@const detailUrl = getFileUrl(selectedMedia)}
  {@const detailIdx = mediaList.findIndex(m => (m.id || m._id) === (selectedMedia.id || selectedMedia._id))}
  {@const hasPrev = detailIdx > 0}
  {@const hasNext = detailIdx < mediaList.length - 1}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={closeDetail}>
    <div
      class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-2xl rounded-2xl shadow-lg p-5 {detailType === 'video' ? 'max-w-3xl' : 'max-w-md'} w-full mx-3 border border-white/20 dark:border-gray-700/20 max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl {getFileColor(selectedMedia)} flex items-center justify-center shrink-0">
            <Icon icon={getFileIcon(selectedMedia)} width="22" height="22" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate text-gray-900 dark:text-gray-100">{selectedMedia.filename}</p>
            <p class="text-xs text-gray-400 dark:text-gray-500">
              {formatSize(selectedMedia.size)} · {selectedMedia.mime_type || '-'}
              {#if imageDimensions}
                · {imageDimensions.width}×{imageDimensions.height}px
              {/if}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button onclick={() => navigateDetail(-1)} disabled={!hasPrev} class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="上一个 (←)">
              <Icon icon="mdi:chevron-left" width="18" height="18" class="text-gray-500 dark:text-gray-400" />
            </button>
            <span class="text-[10px] text-gray-400 dark:text-gray-500">{detailIdx + 1}/{mediaList.length}</span>
            <button onclick={() => navigateDetail(1)} disabled={!hasNext} class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="下一个 (→)">
              <Icon icon="mdi:chevron-right" width="18" height="18" class="text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>
        <div class="bg-gray-100/50 dark:bg-gray-700/30 rounded-xl overflow-hidden relative">
          <div class="absolute top-2 right-2 z-10 flex gap-1">
            {#if detailType === 'image'}
              <button
                onclick={() => { closeDetail(); openLightbox(detailIdx) }}
                class="p-1 rounded-lg bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600 transition-colors"
                title="全屏查看"
              >
                <Icon icon="mdi:magnify-plus" width="14" height="14" class="text-gray-600 dark:text-gray-300" />
              </button>
            {/if}
            <button
              onclick={() => detailPreviewMode = !detailPreviewMode}
              class="p-1 rounded-lg bg-white/80 dark:bg-gray-700/80 shadow hover:bg-white dark:hover:bg-gray-600 transition-colors"
              title={detailPreviewMode ? '图标视图' : '预览视图'}
            >
              <Icon icon={detailPreviewMode ? 'mdi:file-outline' : 'mdi:eye-outline'} width="14" height="14" class="text-gray-600 dark:text-gray-300" />
            </button>
          </div>
          {#if detailPreviewMode}
            {#if detailType === 'image'}
              <img src={detailUrl} alt={selectedMedia.alt_text || selectedMedia.alt || selectedMedia.filename} class="w-full max-h-72 object-contain" loading="lazy" />
            {:else if detailType === 'video'}
              <video src={detailUrl} controls class="w-full" style="max-height: 400px;" preload="metadata"></video>
            {:else if detailType === 'audio'}
              <div class="flex flex-col items-center justify-center py-6 gap-2 {getFileColor(selectedMedia)}">
                <Icon icon={getFileIcon(selectedMedia)} width="48" height="48" />
                <p class="text-sm font-medium">{selectedMedia.filename}</p>
                <audio src={detailUrl} controls class="w-4/5"></audio>
              </div>
            {:else if detailType === 'text'}
              <div class="p-3">
                {#if textPreviewLoading}
                  <div class="text-center text-gray-400 dark:text-gray-500 text-xs py-4">加载内容中...</div>
                {:else if textPreview}
                  <pre class="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto font-mono">{textPreview}</pre>
                {:else}
                  <div class="text-center text-gray-400 dark:text-gray-500 text-xs py-4">无法预览</div>
                {/if}
              </div>
            {:else}
              <div class="flex flex-col items-center justify-center py-5 gap-2 {getFileColor(selectedMedia)}">
                <Icon icon={getFileIcon(selectedMedia)} width="48" height="48" />
                <p class="text-sm font-medium">{selectedMedia.filename}</p>
                <button onclick={() => openFile(selectedMedia)} class="px-4 py-1.5 rounded-full bg-gray-500/80 hover:bg-gray-600/80 text-white text-xs transition-colors flex items-center gap-1">
                  <Icon icon="mdi:open-in-new" width="14" height="14" />
                  打开文件
                </button>
              </div>
            {/if}
          {:else}
            <div class="flex flex-col items-center justify-center py-5 gap-2 {getFileColor(selectedMedia)}">
              <Icon icon={getFileIcon(selectedMedia)} width="48" height="48" />
              <p class="text-sm font-medium">{selectedMedia.filename}</p>
              <button onclick={() => openFile(selectedMedia)} class="px-4 py-1.5 rounded-full bg-gray-500/80 hover:bg-gray-600/80 text-white text-xs transition-colors flex items-center gap-1">
                <Icon icon="mdi:open-in-new" width="14" height="14" />
                打开文件
              </button>
            </div>
          {/if}
        </div>
        <div class="space-y-2.5">
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">文件名</label>
            <input type="text" bind:value={editFilename} class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">URL</label>
            <div class="flex gap-1.5">
              <input type="text" value={getFullUrl(selectedMedia)} readonly class="flex-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 text-xs min-w-0" />
              <button onclick={() => copyUrl(detailUrl)} class="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors shrink-0" title="复制">
                <Icon icon="mdi:content-copy" width="12" height="12" class="text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">Alt 文本</label>
            <input type="text" bind:value={editAlt} placeholder="文件描述" class="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 focus:border-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">嵌入代码</label>
            <div class="flex gap-1.5 flex-wrap">
              <button onclick={() => copyMarkdown(selectedMedia)} class="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white/70 dark:hover:bg-gray-700/70 text-xs text-gray-600 dark:text-gray-400 transition-colors flex items-center gap-1">
                <Icon icon="mdi:language-markdown" width="13" height="13" />
                Markdown
              </button>
              <button onclick={() => copyHtml(selectedMedia)} class="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white/70 dark:hover:bg-gray-700/70 text-xs text-gray-600 dark:text-gray-400 transition-colors flex items-center gap-1">
                <Icon icon="mdi:code-tags" width="13" height="13" />
                HTML
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">替换文件</label>
            <p class="text-[10px] text-gray-400 dark:text-gray-500 mb-1">替换后保持原链接不变</p>
            <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 hover:bg-white/70 dark:hover:bg-gray-700/70 text-xs text-gray-600 dark:text-gray-400 transition-colors cursor-pointer {replacing ? 'opacity-50 pointer-events-none' : ''}">
              {#if replacing}
                替换中...
              {:else}
                <Icon icon="mdi:file-replace" width="13" height="13" />选择新文件
              {/if}
              <input type="file" onchange={handleReplaceFile} class="hidden" />
            </label>
          </div>
        </div>
        <div class="flex justify-between pt-1">
          <button onclick={() => { deleteTarget = selectedMedia }} class="px-3 py-1.5 rounded-full text-red-500 dark:text-red-400 hover:bg-red-50/60 dark:hover:bg-red-900/20 text-xs transition-colors">删除</button>
          <div class="flex gap-1.5">
            <button onclick={() => openFile(selectedMedia)} class="px-3 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-xs transition-colors flex items-center gap-1">
              <Icon icon="mdi:open-in-new" width="12" height="12" />打开
            </button>
            <button onclick={() => downloadFile(selectedMedia)} class="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-xs hover:bg-white/70 dark:hover:bg-gray-700/70 transition-colors flex items-center gap-1">
              <Icon icon="mdi:download" width="12" height="12" />下载
            </button>
            <button onclick={closeDetail} class="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-xs hover:bg-white/70 dark:hover:bg-gray-700/70 transition-colors">关闭</button>
            <button onclick={handleSaveDetail} class="px-3 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-xs transition-colors">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if deleteTarget}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => deleteTarget = null}>
    <div class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-2xl rounded-2xl shadow-lg p-5 max-w-sm w-full mx-3 border border-white/20 dark:border-gray-700/20" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">确认删除</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">确定要删除该文件吗？</p>
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-4">{deleteTarget.filename} ({formatSize(deleteTarget.size)})</p>
      <div class="flex justify-end gap-2">
        <button onclick={() => deleteTarget = null} class="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-xs hover:bg-white/70 dark:hover:bg-gray-700/70 transition-colors">取消</button>
        <button onclick={() => handleDelete(deleteTarget.id || deleteTarget._id)} class="px-3 py-1.5 rounded-full bg-red-500/70 hover:bg-red-600/70 text-white text-xs transition-colors">删除</button>
      </div>
    </div>
  </div>
{/if}

{#if contextMenu}
  <div
    class="fixed z-[60] bg-white/95 dark:bg-gray-800/95 backdrop-blur-2xl rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[160px]"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    onclick={(e) => e.stopPropagation()}
  >
    {#if getFileType(contextMenu.item) === 'image'}
      <button
        onclick={() => { const idx = mediaList.findIndex(m => (m.id || m._id) === (contextMenu.item.id || contextMenu.item._id)); closeContextMenu(); if (idx >= 0) openLightbox(idx) }}
        class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
      >
        <Icon icon="mdi:magnify-plus" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
        全屏查看
      </button>
    {/if}
    <button
      onclick={() => { openFile(contextMenu.item); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:open-in-new" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      打开查看
    </button>
    <button
      onclick={() => { downloadFile(contextMenu.item); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:download" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      下载
    </button>
    <button
      onclick={() => { openDetail(contextMenu.item); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:pencil" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      编辑信息
    </button>
    <div class="border-t border-gray-100 dark:border-gray-800 my-1"></div>
    <button
      onclick={() => { copyUrl(getFileUrl(contextMenu.item)); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:link-variant" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      复制链接
    </button>
    <button
      onclick={() => { copyMarkdown(contextMenu.item); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:language-markdown" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      复制 Markdown
    </button>
    <button
      onclick={() => { copyHtml(contextMenu.item); closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:code-tags" width="14" height="14" class="text-gray-400 dark:text-gray-500" />
      复制 HTML
    </button>
    <div class="border-t border-gray-100 dark:border-gray-800 my-1"></div>
    <button
      onclick={() => { deleteTarget = contextMenu.item; closeContextMenu() }}
      class="w-full px-3 py-1.5 text-left text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2 transition-colors"
    >
      <Icon icon="mdi:delete-outline" width="14" height="14" />
      删除
    </button>
  </div>
{/if}
