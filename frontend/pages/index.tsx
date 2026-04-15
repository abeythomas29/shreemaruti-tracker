import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Package, Upload, Search, MapPin, CheckCircle,
  Clock, Truck, AlertCircle, History, LogIn
} from 'lucide-react'
import API from '../lib/api'
import clsx from 'clsx'

interface TrackingEvent {
  status: string
  location?: string
  description?: string
  event_time?: string
}

interface TrackResult {
  awb: string
  current_status?: string
  current_location?: string
  is_delivered: boolean
  events: TrackingEvent[]
}

function statusIcon(status?: string) {
  const s = (status || '').toLowerCase()
  if (s.includes('delivered')) return <CheckCircle className="text-green-500" size={20} />
  if (s.includes('out for')) return <Truck className="text-blue-500" size={20} />
  if (s.includes('transit')) return <Package className="text-orange-400" size={20} />
  return <Clock className="text-gray-400" size={20} />
}

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [manualAwb, setManualAwb] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TrackResult | null>(null)

  const isLoggedIn = typeof window !== 'undefined' && !!localStorage.getItem('token')

  const doTrack = async (f: File | null, awb: string) => {
    setLoading(true)
    setResult(null)
    try {
      const fd = new FormData()
      if (f) fd.append('image', f)
      if (awb) fd.append('awb_number', awb)
      const { data } = await API.post<TrackResult>('/track/public', fd)
      setResult(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Could not fetch tracking status')
    } finally {
      setLoading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); doTrack(f, '') }
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); doTrack(f, '') }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-gray-50">

      {/* Navbar */}
      <header className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-brand-700 text-lg">
          <Package size={22} /> Shree Maruti Tracker
        </div>
        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <Link href="/history" className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                <History size={15} /> History
              </Link>
              <Link href="/dashboard" className="btn-primary text-sm">Dashboard</Link>
            </>
          ) : (
            <>
              <Link href="/login" className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                <LogIn size={15} /> Log in
              </Link>
              <Link href="/register" className="btn-primary text-sm">Sign up free</Link>
            </>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-10 pb-20">

        {/* Hero text */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-3">
            Track your Shree Maruti shipment
          </h1>
          <p className="text-gray-500 text-base">
            Upload your receipt or enter the AWB number — get live status instantly.
          </p>
        </div>

        {/* Tracking card */}
        <div className="card space-y-4">

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-400 hover:bg-gray-50'
            )}
          >
            <Upload size={28} className="text-gray-400" />
            <p className="text-sm font-medium text-gray-700">
              {file ? file.name : 'Drop receipt photo here or click to upload'}
            </p>
            <p className="text-xs text-gray-400">JPG, PNG, WebP — AI reads the AWB for you</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">OR enter AWB number</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Manual input */}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="e.g. 26038200137771"
              value={manualAwb}
              onChange={e => setManualAwb(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && manualAwb) doTrack(null, manualAwb) }}
            />
            <button
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              disabled={loading || !manualAwb}
              onClick={() => doTrack(null, manualAwb)}
            >
              <Search size={15} />
              {loading ? 'Tracking…' : 'Track'}
            </button>
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="card mt-4 flex items-center gap-4 animate-pulse">
            <div className="w-10 h-10 bg-gray-200 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="card mt-4 space-y-5">
            {/* Status header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-gray-400 font-mono mb-1">AWB {result.awb}</p>
                <div className="flex items-center gap-2">
                  {statusIcon(result.current_status)}
                  <span className="text-lg font-bold text-gray-900">
                    {result.current_status || 'Unknown'}
                  </span>
                </div>
                {result.current_location && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                    <MapPin size={13} /> {result.current_location}
                  </div>
                )}
              </div>
              <span className={clsx(
                'text-xs font-semibold px-3 py-1 rounded-full shrink-0',
                result.is_delivered
                  ? 'bg-green-100 text-green-700'
                  : 'bg-orange-100 text-orange-700'
              )}>
                {result.is_delivered ? 'Delivered' : 'In Progress'}
              </span>
            </div>

            {/* Timeline */}
            {result.events.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Tracking timeline</p>
                <ol className="relative border-l border-gray-200 space-y-4 ml-2">
                  {result.events.map((ev, i) => (
                    <li key={i} className="ml-4">
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

            {/* Sign up nudge */}
            {!isLoggedIn && (
              <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-brand-800">Save your tracking history</p>
                  <p className="text-xs text-brand-600 mt-0.5">Sign up free to track all parcels in one place</p>
                </div>
                <Link href="/register" className="btn-primary text-sm whitespace-nowrap">
                  Sign up free
                </Link>
              </div>
            )}
          </div>
        )}

        {/* How it works — shown before any result */}
        {!result && !loading && (
          <div className="grid grid-cols-3 gap-4 mt-8">
            {[
              { icon: Upload, label: 'Upload receipt', desc: 'Photo of your consignment note' },
              { icon: Package, label: 'AI reads AWB', desc: 'No manual typing needed' },
              { icon: CheckCircle, label: 'Live status', desc: 'Direct from Shree Maruti' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="text-center">
                <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <Icon size={18} className="text-brand-700" />
                </div>
                <p className="text-xs font-semibold text-gray-800">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
