'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useVideoList } from '@/hooks/useVideoList'

interface VideoSelectProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
}

const FONT = 'var(--font-fredoka)'
const BROWN = '#5D3A1A'
const INPUT_BORDER = '#D4B483'

export function VideoSelect({
  value,
  onChange,
  placeholder = 'Search or select video...',
  style: customStyle,
}: VideoSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [videoState, videoActions] = useVideoList()

  const formatLabel = (video: string) => `Sign ${video}`

  // Timeout ref for debounced search
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load videos when dropdown opens
  useEffect(() => {
    if (isOpen && videoState.videos.length === 0 && !videoState.loading) {
      videoActions.loadVideos({ page: 1 })
    }
  }, [isOpen, videoState.videos.length, videoState.loading, videoActions])

  // Handle search input changes
  const handleSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm)
    setHighlightedIndex(-1)
    videoActions.setSearch(searchTerm)
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // Debounce search to avoid too many API calls
    searchTimeoutRef.current = setTimeout(() => {
      videoActions.loadVideos({ page: 1, search: searchTerm })
    }, 300)
  }, [videoActions])

  // Infinite scroll handler
  useEffect(() => {
    if (!dropdownRef.current) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = dropdownRef.current!
      if (scrollTop + clientHeight >= scrollHeight - 50 && videoState.hasMore && !videoState.loading) {
        videoActions.loadNextPage()
      }
    }

    const dropdown = dropdownRef.current
    dropdown.addEventListener('scroll', handleScroll)
    return () => dropdown.removeEventListener('scroll', handleScroll)
  }, [videoState.hasMore, videoState.loading, videoActions])

  const filtered = videoState.videos.filter(video =>
    video.toLowerCase().includes(search.toLowerCase()) ||
    formatLabel(video).toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      setSearch(value)
      setHighlightedIndex(-1)
    }
  }, [isOpen, value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true)
      return
    }

    if (!isOpen) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev < filtered.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0) {
          const selected = filtered[highlightedIndex]
          onChange(selected)
          setIsOpen(false)
          setSearch('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearch('')
        break
      default:
        break
    }
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const baseStyle: React.CSSProperties = {
    fontFamily: FONT,
    color: BROWN,
    fontSize: '0.95rem',
    backgroundColor: '#FFF',
    border: `1.5px solid ${INPUT_BORDER}`,
    borderRadius: '8px',
    padding: '8px 12px',
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={containerRef}>
      {isOpen ? (
        <input
          ref={inputRef}
          type="text"
          value={search}
          placeholder={placeholder}
          onChange={e => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => (e.currentTarget.style.borderColor = '#B5621E')}
          onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
          style={{
            ...baseStyle,
            ...customStyle,
            borderColor: '#B5621E',
          }}
        />
      ) : (
        <div
          onClick={() => setIsOpen(true)}
          onFocus={e => (e.currentTarget.style.borderColor = '#B5621E')}
          onBlur={e => (e.currentTarget.style.borderColor = INPUT_BORDER)}
          style={{
            ...baseStyle,
            ...customStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: value ? BROWN : '#999',
          }}
          tabIndex={0}
          role="button"
        >
          <span>{value ? formatLabel(value) : placeholder}</span>
          <span style={{ fontSize: '0.8rem' }}>▼</span>
        </div>
      )}

      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: '#FFF',
            border: `1.5px solid ${INPUT_BORDER}`,
            borderTopWidth: 0,
            borderRadius: '0 0 8px 8px',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}
        >
          {/* Refresh button */}
          <div
            style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${INPUT_BORDER}`,
              backgroundColor: '#F9F6F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: FONT,
                fontSize: '0.85rem',
                color: '#666',
              }}
            >
              {videoState.total > 0 ? `${videoState.total} videos` : 'No videos loaded'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                videoActions.refresh()
              }}
              disabled={videoState.loading}
              style={{
                background: 'none',
                border: 'none',
                cursor: videoState.loading ? 'not-allowed' : 'pointer',
                color: '#666',
                fontSize: '0.8rem',
                padding: '2px 6px',
                borderRadius: '3px',
                fontFamily: FONT,
              }}
              onMouseEnter={(e) => {
                if (!videoState.loading) e.currentTarget.style.backgroundColor = '#E8D8A0'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              {videoState.loading ? '⟳' : '↻'}
            </button>
          </div>

          {/* Video list */}
          {videoState.loading && videoState.videos.length === 0 ? (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: '#999',
                fontFamily: FONT,
                fontSize: '0.9rem',
              }}
            >
              Loading videos...
            </div>
          ) : filtered.length > 0 ? (
            <>
              {filtered.map((video, index) => (
                <div
                  key={video}
                  onClick={() => {
                    onChange(video)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    backgroundColor:
                      highlightedIndex === index ? '#E8D8A0' : '#FFF',
                    color: BROWN,
                    fontFamily: FONT,
                    fontSize: '0.95rem',
                    borderBottom: index === filtered.length - 1 ? 'none' : `1px solid ${INPUT_BORDER}`,
                    transition: 'background-color 0.2s',
                  }}
                >
                  {formatLabel(video)}
                </div>
              ))}
              {videoState.loading && videoState.videos.length > 0 && (
                <div
                  style={{
                    padding: '8px 12px',
                    textAlign: 'center',
                    color: '#999',
                    fontFamily: FONT,
                    fontSize: '0.85rem',
                    borderTop: `1px solid ${INPUT_BORDER}`,
                  }}
                >
                  Loading more...
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                color: '#999',
                fontFamily: FONT,
                fontSize: '0.9rem',
              }}
            >
              {search ? 'No videos match your search' : 'No videos found'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
