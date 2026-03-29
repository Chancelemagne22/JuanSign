'use client'

import { useState, useRef, useEffect } from 'react'

interface VideoSelectProps {
  value: string
  onChange: (value: string) => void
  videos: string[]
  placeholder?: string
  style?: React.CSSProperties
}

const FONT = 'var(--font-fredoka)'
const BROWN = '#5D3A1A'
const INPUT_BORDER = '#D4B483'

export function VideoSelect({
  value,
  onChange,
  videos,
  placeholder = 'Search or select video...',
  style: customStyle,
}: VideoSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const formatLabel = (video: string) => `Sign ${video}`

  const filtered = videos.filter(video =>
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
          onChange={e => setSearch(e.target.value)}
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
          {filtered.length > 0 ? (
            filtered.map((video, index) => (
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
                  borderBottom: `1px solid ${INPUT_BORDER}`,
                  transition: 'background-color 0.2s',
                }}
              >
                {formatLabel(video)}
              </div>
            ))
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
              No videos found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
