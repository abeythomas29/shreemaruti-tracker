import { useState, useCallback, useRef, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import {
  Package, Upload, Search, MapPin, CheckCircle,
  Clock, Truck, AlertCircle, X, LogIn, UserPlus, ChevronDown, Camera, Copy, ExternalLink
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
  courier?: string
  current_status?: string
  current_location?: string
  is_delivered: boolean
  events: TrackingEvent[]
  origin?: string
  destination?: string
}

const COURIERS = [
  { id: 'auto',        name: 'Auto-detect courier' },
  { id: 'shreemaruti', name: 'Shree Maruti' },
  { id: 'india_post',  name: 'India Post' },
  { id: 'ekart',       name: 'Ekart (Flipkart)' },
  { id: 'shadowfax',   name: 'Shadowfax' },
  { id: 'gati',        name: 'Gati KWE' },
  { id: 'aramex',      name: 'Aramex' },
  { id: 'dtdc',        name: 'DTDC Express' },
]

const COURIER_LABEL: Record<string, string> = Object.fromEntries(
  COURIERS.map(c => [c.id, c.name])
)

const COURIER_TRACKING_URL: Record<string, (awb: string) => string> = {
  dtdc:        (awb) => `https://www.dtdc.in/tracking.asp?Ttype=consignment&TNo=${awb}`,
  bluedart:    (awb) => `https://www.bluedart.com/web/guest/trackdartship?trackFor=0&trackID=${awb}`,
  delhivery:   (awb) => `https://www.delhivery.com/track/package/${awb}`,
  xpressbees:  (awb) => `https://www.xpressbees.com/shipment/tracking?awbNo=${awb}`,
  india_post:  (awb) => `https://www.indiapost.gov.in/vas/pages/trackconsignment.aspx?ConsignmentNo=${awb}`,
  ekart:       (awb) => `https://ekartlogistics.com/track?trackingId=${awb}`,
  shadowfax:   (awb) => `https://tracker.shadowfax.in/#${awb}`,
  gati:        (awb) => `https://www.gati.com/track-docket?docket=${awb}`,
  aramex:      (awb) => `https://www.aramex.com/us/en/track/results?ShipmentNumber=${awb}`,
  shreemaruti: (awb) => `https://tracking.shreemaruti.com/${awb}`,
}

function statusIcon(status?: string) {
  const s = (status || '').toLowerCase()
  if (s.includes('delivered')) return <CheckCircle className="text-green-500" size={20} />
  if (s.includes('out for'))   return <Truck className="text-blue-500" size={20} />
  if (s.includes('transit') || s.includes('hub')) return <Package className="text-orange-400" size={20} />
  return <Clock className="text-gray-400" size={20} />
}

function AuthGateModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Package size={22} className="text-brand-700" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Save your tracking history</h2>
          <p className="text-sm text-gray-500 mt-1">
            Create a free account to view all your shipments in one dashboard and get delivery updates.
          </p>
        </div>
        <div className="space-y-3">
          <Link href="/register" className="btn-primary w-full flex items-center justify-center gap-2">
            <UserPlus size={16} /> Create free account
          </Link>
          <Link href="/login" className="btn-secondary w-full flex items-center justify-center gap-2">
            <LogIn size={16} /> Sign in
          </Link>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">
          No credit card required · Free plan available
        </p>
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const fileRef    = useRef<HTMLInputElement>(null)
  const cameraRef  = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]       = useState(false)
  const [file, setFile]               = useState<File | null>(null)
  const [manualAwb, setManualAwb]     = useState('')
  const [courier, setCourier]         = useState('auto')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<TrackResult | null>(null)
  const [showAuthGate, setShowAuthGate] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('token')) {
      router.replace('/dashboard')
    }
  }, [router])

  const doTrack = async (f: File | null, awb: string) => {
    setLoading(true)
    setResult(null)
    setShowAuthGate(false)
    try {
      const fd = new FormData()
      if (f)   fd.append('image', f)
      if (awb) fd.append('awb_number', awb)
      fd.append('courier', courier)
      const { data } = await API.post<TrackResult>('/track/public', fd)
      setResult(data)
      const remaining = (data as any).searches_remaining ?? 0
      setTimeout(() => setShowAuthGate(true), remaining === 0 ? 0 : 1200)
    } catch (err: any) {
      if (err.response?.status === 429) {
        setShowAuthGate(true)
        toast.error('Daily limit reached — sign up for unlimited tracking!')
      } else {
        toast.error(err.response?.data?.detail || 'Could not fetch tracking status')
      }
    } finally {
      setLoading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); doTrack(f, '') }
  }, [courier])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); doTrack(f, '') }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-gray-50">
      <Head>
        <title>Courier Track AI – Track Any Shipment Instantly</title>
        <meta name="description" content="Track shipments from 13+ Indian couriers including Delhivery, DTDC, India Post, Shree Maruti, Shadowfax, Gati, Amazon and more. AI-powered AWB extraction." />
      </Head>

      {showAuthGate && <AuthGateModal onClose={() => setShowAuthGate(false)} />}

      {/* Navbar */}
      <header className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-brand-700 text-lg">
          <Package size={22} /> Courier Track AI
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-secondary text-sm flex items-center gap-1.5">
            <LogIn size={14} /> Log in
          </Link>
          <Link href="/register" className="btn-primary text-sm">Sign up free</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-10 pb-20">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-3">
            Track any courier shipment
          </h1>
          <p className="text-gray-500 text-base">
            Upload your receipt or enter the AWB number — get live status across 13+ couriers.
          </p>
        </div>

        {/* Tracking card */}
        <div className="card space-y-4">

          {/* Courier selector */}
          <div className="relative">
            <select
              value={courier}
              onChange={e => setCourier(e.target.value)}
              className="input w-full appearance-none pr-8 cursor-pointer"
            >
              {COURIERS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>


          {/* Upload / Camera buttons */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={clsx(
              'border-2 border-dashed rounded-xl p-5 transition-colors',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200'
            )}
          >
            {file ? (
              <p className="text-sm font-medium text-gray-700 text-center py-2">{file.name}</p>
            ) : (
              <>
                <p className="text-xs text-center text-gray-400 mb-3">Drop a receipt here, or use the buttons below</p>
                <div className="flex gap-2">
                  {/* Gallery upload */}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-400 text-gray-700 hover:text-brand-700 font-medium text-sm py-3 rounded-xl transition-colors"
                  >
                    <Upload size={17} /> Upload photo
                  </button>
                  {/* Camera capture (opens camera directly on mobile) */}
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-400 text-gray-700 hover:text-brand-700 font-medium text-sm py-3 rounded-xl transition-colors"
                  >
                    <Camera size={17} /> Take photo
                  </button>
                </div>
              </>
            )}
            {/* Hidden inputs */}
            <input ref={fileRef}   type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">OR enter AWB number</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

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
          <div className={clsx('card mt-4 space-y-5 transition-all', showAuthGate && 'blur-sm pointer-events-none select-none')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-gray-400 font-mono">AWB {result.awb}</p>
                  {result.courier && result.courier !== 'auto' && (
                    <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">
                      {COURIER_LABEL[result.courier] ?? result.courier}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {statusIcon(result.current_status)}
                  <span className="text-lg font-bold text-gray-900">{result.current_status || 'Unknown'}</span>
                </div>
                {result.current_location && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                    <MapPin size={13} /> {result.current_location}
                  </div>
                )}
                {result.origin && result.destination && (
                  <p className="text-xs text-gray-400 mt-1">{result.origin} → {result.destination}</p>
                )}
              </div>
              <span className={clsx(
                'text-xs font-semibold px-3 py-1 rounded-full shrink-0',
                result.is_delivered ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
              )}>
                {result.is_delivered ? 'Delivered' : 'In Progress'}
              </span>
            </div>

            {result.events.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Tracking timeline</p>
                <ol className="relative border-l border-gray-200 space-y-4 ml-2">
                  {result.events.slice(0, 5).map((ev, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-white bg-brand-500" />
                      <p className="text-sm font-medium text-gray-800">{ev.status}</p>
                      {ev.description && ev.description !== ev.status && (
                        <p className="text-xs text-gray-500">{ev.description}</p>
                      )}
                      {ev.location && <p className="text-xs text-gray-500">{ev.location}</p>}
                      {ev.event_time && <p className="text-xs text-gray-400">{ev.event_time}</p>}
                    </li>
                  ))}
                </ol>
                {result.events.length > 5 && (
                  <p className="text-xs text-gray-400 mt-2 ml-2">+{result.events.length - 5} more events — sign in to see all</p>
                )}
              </div>
            )}

            {result.events.length === 0 && (() => {
              const trackUrl = result.courier ? COURIER_TRACKING_URL[result.courier]?.(result.awb) : null
              const courierName = result.courier ? (COURIER_LABEL[result.courier] ?? result.courier) : 'the courier'
              return (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">
                    <span className="font-medium">{courierName}</span> cannot be tracked automatically.
                    Use the tracking ID below on their website.
                  </p>
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
                    <span className="font-mono text-sm font-semibold text-gray-800 flex-1 select-all">{result.awb}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.awb)
                        toast.success('Tracking ID copied!')
                      }}
                      className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium shrink-0"
                    >
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  {trackUrl && (
                    <a
                      href={trackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-800"
                    >
                      <ExternalLink size={14} />
                      Track on {courierName} website
                    </a>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* How it works */}
        {!result && !loading && (
          <div className="grid grid-cols-3 gap-4 mt-8">
            {[
              { icon: Upload,      label: 'Upload receipt',  desc: 'Photo of your consignment note' },
              { icon: Package,     label: 'AI reads AWB',    desc: 'No manual typing needed' },
              { icon: CheckCircle, label: 'Live status',     desc: '13+ couriers supported' },
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

        {/* Supported couriers strip */}
        {!result && !loading && (
          <p className="text-center text-xs text-gray-400 mt-6">
            Supports: Shree Maruti · India Post · Ekart (Flipkart) · Shadowfax · Gati KWE · Aramex
          </p>
        )}
      </main>
    </div>
  )
}
