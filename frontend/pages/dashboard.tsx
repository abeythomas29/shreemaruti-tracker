import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import { Upload, Search, Package, MapPin, CheckCircle, Clock, Truck, AlertCircle } from 'lucide-react'
import Navbar from '../components/Navbar'
import API from '../lib/api'
import clsx from 'clsx'

interface TrackingEvent {
  id: number
  status: string
  location?: string
  description?: string
  event_time?: string
}

interface Scan {
  id: number
  awb_number: string
  current_status?: string
  current_location?: string
  is_delivered: boolean
  delivery_date?: string
  last_checked?: string
  created_at: string
  events: TrackingEvent[]
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  Delivered: <CheckCircle className="text-green-500" size={20} />,
  'Out for Delivery': <Truck className="text-blue-500" size={20} />,
  'In Transit': <Package className="text-orange-400" size={20} />,
  default: <Clock className="text-gray-400" size={20} />,
}

function statusIcon(status?: string) {
  if (!status) return STATUS_ICON.default
  return STATUS_ICON[status] ?? STATUS_ICON.default
}

export default function Dashboard() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [manualAwb, setManualAwb] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Scan | null>(null)
  const [lastDelivery, setLastDelivery] = useState<Scan | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { router.replace('/login'); return }
    API.get('/history/last-delivery').then(r => setLastDelivery(r.data)).catch(() => {})

    if (router.query.subscription === 'success') {
      toast.success('Subscription activated! You can now scan without an API key.')
    }
  }, [router])

  const doScan = async (f: File | null, awb: string) => {
    setLoading(true)
    setResult(null)
    try {
      const fd = new FormData()
      if (f) fd.append('image', f)
      if (awb) fd.append('awb_number', awb)
      const { data } = await API.post<Scan>('/scan', fd)
      setResult(data)
      toast.success('Tracking fetched!')
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to fetch tracking'
      if (err.response?.status === 402) {
        toast.error('Add your API key or subscribe to use AI scanning.', { duration: 6000 })
      } else {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); doScan(f, '') }
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); doScan(f, '') }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Last delivery banner */}
        {lastDelivery && (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
            <CheckCircle className="text-green-500 shrink-0" size={18} />
            <span className="text-green-800">
              Last delivery: <strong>{lastDelivery.awb_number}</strong> — {lastDelivery.current_location || 'Delivered'} on {new Date(lastDelivery.created_at).toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Upload area */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-900">Track a Shipment</h2>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-400'
            )}
          >
            <Upload size={32} className="text-gray-400" />
            <p className="text-sm text-gray-600 font-medium">
              {file ? file.name : 'Drop receipt image here or click to upload'}
            </p>
            <p className="text-xs text-gray-400">JPG, PNG, WebP supported</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">OR enter AWB manually</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="e.g. 26038200137771"
              value={manualAwb}
              onChange={e => setManualAwb(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && manualAwb) doScan(null, manualAwb) }}
            />
            <button
              className="btn-primary flex items-center gap-2"
              disabled={loading || !manualAwb}
              onClick={() => doScan(null, manualAwb)}
            >
              <Search size={16} />
              {loading ? 'Tracking…' : 'Track'}
            </button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="card flex items-center gap-4 animate-pulse">
            <div className="w-10 h-10 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="card space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 mb-0.5 font-mono">AWB {result.awb_number}</p>
                <div className="flex items-center gap-2">
                  {statusIcon(result.current_status)}
                  <span className="text-lg font-bold text-gray-900">{result.current_status || 'Unknown'}</span>
                </div>
                {result.current_location && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                    <MapPin size={13} /> {result.current_location}
                  </div>
                )}
              </div>
              <span className={clsx(
                'text-xs font-semibold px-3 py-1 rounded-full',
                result.is_delivered ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
              )}>
                {result.is_delivered ? 'Delivered' : 'In Progress'}
              </span>
            </div>

            {/* Events timeline */}
            {result.events.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Tracking timeline</p>
                <ol className="relative border-l border-gray-200 space-y-4 ml-2">
                  {result.events.map((ev, i) => (
                    <li key={ev.id ?? i} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-white bg-brand-500" />
                      <p className="text-sm font-medium text-gray-800">{ev.status}</p>
                      {ev.location && <p className="text-xs text-gray-500">{ev.location}</p>}
                      {ev.event_time && <p className="text-xs text-gray-400">{ev.event_time}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {result.events.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                <AlertCircle size={15} /> No detailed events available yet.
              </div>
            )}

            <p className="text-xs text-gray-400">
              Last checked: {result.last_checked ? new Date(result.last_checked).toLocaleString() : 'just now'}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
