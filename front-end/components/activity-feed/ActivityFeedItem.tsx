import React from 'react'

interface ActivityItemProps {
  item: {
    id: string
    type: 'ml_prediction' | 'new_member' | 'assessment'
    timestamp: string
    data: Record<string, any>
  }
}

export default function ActivityFeedItem({ item }: ActivityItemProps) {
  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getIconAndColor = (type: string) => {
    switch (type) {
      case 'ml_prediction':
        return { icon: '🤖', bgColor: '#E3F2FD', borderColor: '#2196F3' }
      case 'new_member':
        return { icon: '👤', bgColor: '#F3E5F5', borderColor: '#9C27B0' }
      case 'assessment':
        return { icon: '✓', bgColor: '#E8F5E9', borderColor: '#4CAF50' }
      default:
        return { icon: '•', bgColor: '#F5F5F5', borderColor: '#999' }
    }
  }

  const { icon, bgColor, borderColor } = getIconAndColor(item.type)

  return (
    <div className="flex gap-4 items-start">
      {/* Icon circle */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-xl mt-1 flex-shrink-0"
        style={{ backgroundColor: bgColor, border: `2px solid ${borderColor}` }}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 flex-grow">
        {item.type === 'ml_prediction' && (
          <div>
            <p className="font-semibold text-gray-800">{item.data.userName}</p>
            <p className="text-sm text-gray-600 mt-1">
              Target: <span className="font-mono font-semibold">{item.data.targetSign}</span> →
              Predicted: <span className="font-mono font-semibold">{item.data.predictedSign}</span>
            </p>
            <p className="text-xs text-blue-600 mt-2">Confidence: {Math.round(item.data.confidence * 100)}%</p>
            <p className="text-xs text-gray-500 mt-2">{formatDate(item.timestamp)}</p>
          </div>
        )}

        {item.type === 'new_member' && (
          <div>
            <p className="font-semibold text-gray-800">New Member Joined</p>
            <p className="text-sm text-gray-600 mt-1">{item.data.name}</p>
            <p className="text-xs text-gray-500 mt-2">{formatDate(item.timestamp)}</p>
          </div>
        )}

        {item.type === 'assessment' && (
          <div>
            <p className="font-semibold text-gray-800">{item.data.userName}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-600">Score: {Math.round(item.data.score)}%</span>
              <span
                className={`px-2 py-1 rounded text-xs font-semibold ${
                  item.data.passed
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {item.data.passed ? '✓ Passed' : '✗ Failed'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2">{formatDate(item.timestamp)}</p>
          </div>
        )}
      </div>
    </div>
  )
}