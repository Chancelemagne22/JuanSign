'use client'

import { useState, useCallback, useRef } from 'react'
import { listLessonVideos } from '@/lib/storage'

interface VideoListState {
  videos: string[]
  total: number
  page: number
  limit: number
  hasMore: boolean
  loading: boolean
  error: string | null
  searchQuery: string
}

interface VideoListActions {
  loadVideos: (options?: { page?: number; search?: string; forceRefresh?: boolean }) => Promise<void>
  loadNextPage: () => Promise<void>
  setSearch: (search: string) => void
  refresh: () => Promise<void>
}

export function useVideoList(initialLimit = 20): [VideoListState, VideoListActions] {
  const [state, setState] = useState<VideoListState>({
    videos: [],
    total: 0,
    page: 1,
    limit: initialLimit,
    hasMore: false,
    loading: false,
    error: null,
    searchQuery: ''
  })

  const loadedPagesRef = useRef<Set<number>>(new Set())
  const allVideosRef = useRef<string[]>([])

  const loadVideos = useCallback(async (options: { page?: number; search?: string; forceRefresh?: boolean } = {}) => {
    const { page = 1, search = '', forceRefresh = false } = options

    // If searching and not forcing refresh, filter from cached videos
    if (search && !forceRefresh && allVideosRef.current.length > 0) {
      const filtered = allVideosRef.current.filter(video =>
        video.toLowerCase().includes(search.toLowerCase())
      )
      const startIndex = (page - 1) * state.limit
      const endIndex = startIndex + state.limit
      const paginatedVideos = filtered.slice(startIndex, endIndex)

      setState(prev => ({
        ...prev,
        videos: paginatedVideos,
        total: filtered.length,
        page,
        hasMore: endIndex < filtered.length,
        loading: false,
        error: null,
        searchQuery: search
      }))
      return
    }

    // If page already loaded and not forcing refresh, don't reload
    if (!forceRefresh && loadedPagesRef.current.has(page) && search === state.searchQuery) {
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const result = await listLessonVideos({
        page,
        limit: state.limit,
        search: search || undefined
      })

      if (page === 1 || search !== state.searchQuery || forceRefresh) {
        // Reset cache for new search or refresh
        loadedPagesRef.current.clear()
        allVideosRef.current = []
      }

      if (search) {
        // For search results, replace the list
        setState(prev => ({
          ...prev,
          videos: result.videos,
          total: result.total,
          page: result.page,
          hasMore: result.hasMore,
          loading: false,
          searchQuery: search
        }))
      } else {
        // For regular pagination, accumulate videos
        allVideosRef.current = [...new Set([...allVideosRef.current, ...result.videos])]
        loadedPagesRef.current.add(page)

        setState(prev => ({
          ...prev,
          videos: page === 1 ? result.videos : [...prev.videos, ...result.videos],
          total: result.total,
          page: result.page,
          hasMore: result.hasMore,
          loading: false,
          searchQuery: ''
        }))
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load videos'
      }))
    }
  }, [state.limit, state.searchQuery])

  const loadNextPage = useCallback(async () => {
    if (!state.hasMore || state.loading) return
    await loadVideos({ page: state.page + 1, search: state.searchQuery })
  }, [state.hasMore, state.loading, state.page, state.searchQuery, loadVideos])

  const setSearch = useCallback((search: string) => {
    setState(prev => ({ ...prev, searchQuery: search }))
  }, [])

  const refresh = useCallback(async () => {
    loadedPagesRef.current.clear()
    allVideosRef.current = []
    await loadVideos({ page: 1, forceRefresh: true })
  }, [loadVideos])

  return [state, { loadVideos, loadNextPage, setSearch, refresh }]
}