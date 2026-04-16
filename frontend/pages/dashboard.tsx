import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import {
  Upload, Search, Package, MapPin, CheckCircle,
  Clock, Truck, RefreshCw, Plus, X, ChevronDown, Camera, Copy, ExternalLink
} from 'lucide-react'
import Navbar from '../components/Navbar'
import API from '../lib/api'
import clsx from 'clsx'

interface Scan {
  id: number
  awb_number: string
  courier?: string
  current_status?: string
  current_location?: string
  is_delivered: boolean
  last_checked?: string
  created_at: string
  events: any[]
}

function StatusBadge({ status, delivered }: { status?: string; delivered: boolean }) {
  const s = (status || '').toLowerCase()
  if (delivered) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
      <CheckCircle size={11} /> Delivered
    </span>
  )
  if (s.includes('out for')) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
      <Truck size={11} /> Out for Delivery
    </span>
  )
  if (s.includes('transit') || s.includes('hub')) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-100 px-2.5 py-1 rounded-full">
      <Package size={11} /> In Transit
    </span>
  )
  if (s.includes('track on courier')) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-100 px-2.5 py-1 rounded-full">
      <ExternalLink size={11} /> Manual tracking
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
      <Clock size={11} /> {status || 'Unknown'}
    </span>
  )
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

// ── Track new shipment panel ──────────────────────────────────────────
function TrackPanel({ onScanned }: { onScanned: (scan: Scan) => void }) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [manualAwb, setManualAwb] = useState('')
  const [courier, setCourier] = useState('auto')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const doScan = async (file: File | null, awb: string) => {
    setLoading(true)
    try {
      const fd = new FormData()
      if (file) fd.append('image', file)
      if (awb) fd.append('awb_number', awb)
      fd.append('courier', courier)
      const { data } = await API.post<Scan>('/scan', fd)
      onScanned(data)
      setManualAwb('')
      setOpen(false)
      toast.success('Tracking saved to dashboard!')
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to track'
      if (err.response?.status === 402) {
        toast.error('Add your OpenAI API key or subscribe in Settings to scan receipts.')
      } else {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="btn-primary flex items-center gap-2"
    >
      <Plus size={16} /> Track new shipment
    </button>
  )

  return (
    <div className="card border-brand-200 border-2 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Track a shipment</h3>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      {/* Courier selector */}
      <div className="relative">
        <select
          value={courier}
          onChange={e => setCourier(e.target.value)}
          className="input w-full appearance-none pr-8 cursor-pointer text-sm"
        >
          {COURIERS.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
        <div className="flex gap-2">
          {/* Gallery upload */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-400 text-gray-700 hover:text-brand-700 font-medium text-sm py-3 rounded-xl transition-colors"
          >
            <Upload size={16} /> Upload photo
          </button>
          {/* Camera capture — opens camera directly on mobile */}
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-400 text-gray-700 hover:text-brand-700 font-medium text-sm py-3 rounded-xl transition-colors"
          >
            <Camera size={16} /> Take photo
          </button>
        </div>
        <p className="text-xs text-center text-gray-400 mt-2">AI reads the AWB number for you</p>
        <input ref={fileRef}   type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) doScan(f, '') }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) doScan(f, '') }} />
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Or enter AWB manually"
          value={manualAwb}
          onChange={e => setManualAwb(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && manualAwb) doScan(null, manualAwb) }}
        />
        <button
          className="btn-primary flex items-center gap-2"
          disabled={loading || !manualAwb}
          onClick={() => doScan(null, manualAwb)}
        >
          <Search size={15} />
          {loading ? 'Tracking…' : 'Track'}
        </button>
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter()
  const [scans, setScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('token')) { router.replace('/login'); return }
    API.get<Scan[]>('/history')
      .then(r => setScans(r.data))
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false))
    if (router.query.subscription === 'success') {
      toast.success('Subscription activated!')
    }
  }, [router])

  const refresh = async (awb: string) => {
    setRefreshing(awb)
    try {
      const { data } = await API.get<Scan>(`/scan/${awb}`)
      setScans(prev => prev.map(s => s.awb_number === awb ? { ...s, ...data } : s))
      toast.success('Status updated')
    } catch {
      toast.error('Failed to refresh')
    } finally {
      setRefreshing(null)
    }
  }

  const onScanned = (scan: Scan) => {
    setScans(prev => {
      const exists = prev.find(s => s.awb_number === scan.awb_number)
      if (exists) return prev.map(s => s.awb_number === scan.awb_number ? { ...s, ...scan } : s)
      return [scan, ...prev]
    })
  }

  const delivered = scans.filter(s => s.is_delivered).length
  const inProgress = scans.filter(s => !s.is_delivered).length

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Shipments</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {scans.length} total · {inProgress} in progress · {delivered} delivered
            </p>
          </div>
          <TrackPanel onScanned={onScanned} />
        </div>

        {/* Stats */}
        {scans.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total tracked', value: scans.length, color: 'text-gray-900' },
              { label: 'In progress', value: inProgress, color: 'text-orange-500' },
              { label: 'Delivered', value: delivered, color: 'text-green-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card text-center py-4">
                <p className={clsx('text-2xl font-extrabold', color)}>{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Shipment cards */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
          </div>
        )}

        {!loading && scans.length === 0 && (
          <div className="card text-center py-16">
            <Package size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-600">No shipments yet</p>
            <p className="text-sm text-gray-400 mt-1">Click "Track new shipment" to get started</p>
          </div>
        )}

        {!loading && scans.map(scan => (
          <div key={scan.id} className="card space-y-0 p-0 overflow-hidden">
            {/* Card header */}
            <div
              className="flex items-center gap-4 p-5 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setExpanded(expanded === scan.id ? null : scan.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-mono font-semibold text-gray-900 text-sm">{scan.awb_number}</p>
                  <StatusBadge status={scan.current_status} delivered={scan.is_delivered} />
                  {scan.courier && scan.courier !== 'shreemaruti' && (
                    <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">
                      {COURIER_LABEL[scan.courier] ?? scan.courier}
                    </span>
                  )}
                </div>
                {scan.current_location && (
                  <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <MapPin size={11} /> {scan.current_location}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {scan.courier ? (COURIER_LABEL[scan.courier] ?? scan.courier) : 'Shree Maruti'} ·{' '}
                  Tracked {new Date(scan.created_at).toLocaleDateString()} ·{' '}
                  {scan.last_checked ? `checked ${new Date(scan.last_checked).toLocaleTimeString()}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!scan.is_delivered && (
                  <button
                    onClick={e => { e.stopPropagation(); refresh(scan.awb_number) }}
                    disabled={refreshing === scan.awb_number}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-brand-600 transition-colors"
                    title="Refresh status"
                  >
                    <RefreshCw size={15} className={clsx(refreshing === scan.awb_number && 'animate-spin')} />
                  </button>
                )}
                <span className="text-gray-300 text-lg">{expanded === scan.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded timeline */}
            {expanded === scan.id && scan.events.length > 0 && (
              <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Timeline</p>
                <ol className="relative border-l border-gray-200 space-y-3 ml-2">
                  {scan.events.map((ev, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full border-2 border-white bg-brand-500" />
                      <p className="text-sm font-medium text-gray-800">{ev.status}</p>
                      {ev.description && ev.description !== ev.status && (
                        <p className="text-xs text-gray-500">{ev.description}</p>
                      )}
                      {ev.location && <p className="text-xs text-gray-500">{ev.location}</p>}
                      {ev.event_time && <p className="text-xs text-gray-400">{ev.event_time}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {expanded === scan.id && scan.events.length === 0 && (() => {
              const isManual = (scan.current_status || '').toLowerCase().includes('track on courier')
              const trackUrl = scan.courier ? COURIER_TRACKING_URL[scan.courier]?.(scan.awb_number) : null
              if (!isManual) return (
                <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-400 bg-gray-50">
                  No timeline events yet.
                </div>
              )
              return (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
                  <p className="text-sm text-gray-500">
                    <span className="font-medium">{COURIER_LABEL[scan.courier ?? ''] ?? scan.courier ?? 'This courier'}</span>
                    {' '}cannot be tracked automatically. Use the tracking ID below on their website.
                  </p>
                  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
                    <span className="font-mono text-sm font-semibold text-gray-800 flex-1 select-all">{scan.awb_number}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(scan.awb_number)
                        toast.success('Tracking ID copied!')
                      }}
                      className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium shrink-0"
                      title="Copy tracking ID"
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
                      Track on {COURIER_LABEL[scan.courier ?? ''] ?? scan.courier} website
                    </a>
                  )}
                </div>
              )
            })()}
          </div>
        ))}
      </main>
    </div>
  )
}
