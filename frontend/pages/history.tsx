import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { CheckCircle, Clock, Package, Truck, RefreshCw, MapPin } from 'lucide-react'
import Navbar from '../components/Navbar'
import API from '../lib/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

interface Scan {
  id: number
  awb_number: string
  current_status?: string
  current_location?: string
  is_delivered: boolean
  last_checked?: string
  created_at: string
}

function StatusBadge({ status, delivered }: { status?: string; delivered: boolean }) {
  if (delivered) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
      <CheckCircle size={11} /> Delivered
    </span>
  )
  if (status === 'Out for Delivery') return (
    <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
      <Truck size={11} /> Out for Delivery
    </span>
  )
  if (status === 'In Transit') return (
    <span className="flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
      <Package size={11} /> In Transit
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
      <Clock size={11} /> {status || 'Unknown'}
    </span>
  )
}

export default function History() {
  const router = useRouter()
  const [scans, setScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState<string | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { router.replace('/login'); return }
    API.get<Scan[]>('/history').then(r => setScans(r.data)).finally(() => setLoading(false))
  }, [router])

  const refresh = async (awb: string) => {
    setRefreshing(awb)
    try {
      const { data } = await API.get<Scan>(`/scan/${awb}`)
      setScans(prev => prev.map(s => s.awb_number === awb ? { ...s, ...data } : s))
      toast.success('Status refreshed')
    } catch {
      toast.error('Failed to refresh')
    } finally {
      setRefreshing(null)
    }
  }

  const delivered = scans.filter(s => s.is_delivered)
  const inProgress = scans.filter(s => !s.is_delivered)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total scans', value: scans.length, color: 'text-gray-900' },
            { label: 'Delivered', value: delivered.length, color: 'text-green-600' },
            { label: 'In progress', value: inProgress.length, color: 'text-orange-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card text-center">
              <p className={clsx('text-2xl font-extrabold', color)}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Scans list */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">All shipments</h2>

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && scans.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No shipments yet. Go to Dashboard and scan a receipt.
            </p>
          )}

          {!loading && scans.length > 0 && (
            <div className="divide-y divide-gray-100">
              {scans.map(scan => (
                <div key={scan.id} className="py-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold text-gray-800 truncate">{scan.awb_number}</p>
                    {scan.current_location && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} /> {scan.current_location}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      Scanned {new Date(scan.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={scan.current_status} delivered={scan.is_delivered} />
                  {!scan.is_delivered && (
                    <button
                      onClick={() => refresh(scan.awb_number)}
                      disabled={refreshing === scan.awb_number}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700"
                      title="Refresh status"
                    >
                      <RefreshCw size={15} className={clsx(refreshing === scan.awb_number && 'animate-spin')} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
