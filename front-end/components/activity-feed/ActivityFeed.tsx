'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import ActivityFeedItem from './ActivityFeedItem'

interface ActivityItem {
  id: string
  type: 'ml_prediction' | 'new_member' | 'assessment'
  timestamp: string
  data: Record<string, any>
}

export default function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const loadMore = async () => {
    try {
      const limit = 10
      const newOffset = offset + limit

      // Fetch ML Predictions
      const { data: predictions } = await supabase
        .from('practice_sessions')
        .select(
          `
          id,
          created_at,
          auth_user_id,
          target_sign,
          predicted_sign,
          confidence,
          profiles (full_name)
        `
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      // Fetch New Members
      const { data: members } = await supabase
        .from('profiles')
        .select('id, full_name, created_at')
        .eq('role', 'student')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      // Fetch Assessments
      const { data: assessments } = await supabase
        .from('assessment_results')
        .select(
          `
          id,
          created_at,
          score,
          passed,
          user_id,
          profiles (full_name)
        `
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      const newItems: ActivityItem[] = []

      predictions?.forEach((p: any) => {
        newItems.push({
          id: `pred_${p.id}`,
          type: 'ml_prediction',
          timestamp: p.created_at,
          data: {
            userName: p.profiles?.full_name || 'Unknown User',
            targetSign: p.target_sign,
            predictedSign: p.predicted_sign,
            confidence: p.confidence,
          },
        })
      })

      members?.forEach((m: any) => {
        newItems.push({
          id: `member_${m.id}`,
          type: 'new_member',
          timestamp: m.created_at,
          data: {
            name: m.full_name,
            joinDate: m.created_at,
          },
        })
      })

      assessments?.forEach((a: any) => {
        newItems.push({
          id: `assess_${a.id}`,
          type: 'assessment',
          timestamp: a.created_at,
          data: {
            userName: a.profiles?.full_name || 'Unknown User',
            score: a.score,
            passed: a.passed,
          },
        })
      })

      // Sort by timestamp
      newItems.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      setItems([...items, ...newItems])
      setOffset(newOffset)
      setHasMore(
        (predictions?.length === limit || members?.length === limit || assessments?.length === limit)
      )
    } catch (error) {
      console.error('Error loading activity:', error)
    }
  }

  useEffect(() => {
    setLoading(true)
    loadMore().then(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#C17A3A' }}></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        {/* Timeline line */}
        <div
          className="absolute left-4 top-0 bottom-0 w-1"
          style={{ backgroundColor: '#C17A3A' }}
        ></div>

        {/* Activity items */}
        <div className="space-y-6 pl-16">
          {items.map((item) => (
            <ActivityFeedItem key={item.id} item={item} />
          ))}
        </div>
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-4 rounded transition mt-6"
        >
          Load More
        </button>
      )}

      {!hasMore && items.length > 0 && (
        <p className="text-center text-gray-500 py-4">No more activity</p>
      )}
    </div>
  )
}