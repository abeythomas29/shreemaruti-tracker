import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import {
  Upload, Search, Package, MapPin, CheckCircle,
  Clock, Truck, RefreshCw, Plus, X, ChevronDown
} from 'lucide-react'
import Navbar from '../components/Navbar'
import API from '../lib/api'
import clsx from 'clsx'

interface Scan {
  id: number
  awb_number: string
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
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
      <Clock size={11} /> {status || 'Unknown'}
    </span>
  )
}
const COURIERS = [
  { id: 'auto',        name: 'Auto-detect' },
  { id: 'shreemaruti', name: 'Shree Maruti' },
  { id: 'delhivery',   name: 'Delhivery' },
  { id: 'india_post',  name: 'India Post' },
  { id: 'ekart',       name: 'Ekart (Flipkart)' },
  { id: 'dtdc',        name: 'DTDC' },
  { id: 'xpressbees',  name: 'XpressBees' },
  { id: 'bluedart',    name: 'BlueDart' },
  { id: 'shadowfax',   name: 'Shadowfax' },
  { id: 'gati',        name: 'Gati KWE' },
  { id: 'smartr',      name: 'Smartr Logistics' },
  { id: 'amazon',      name: 'Amazon Logistics' },
  { id: 'aramex',      name: 'Aramex' },
  { id: 'rivigo',      name: 'Rivigo / Porter' },
]

// ── Track new shipment panel ──────────────────────────────────────────
function TrackPanel({ onScanned }: { onScanned: (scan: Scan) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
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
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-200 hover:border-brand-400 rounded-xl p-5 flex items-center gap-3 cursor-pointer transition-colors"
      >
        <Upload size={20} className="text-gray-400 shrink-0" />
        <p className="text-sm text-gray-500">Upload receipt photo — AI reads the AWB</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
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
                </div>
                {scan.current_location && (
                  <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <MapPin size={11} /> {scan.current_location}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
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
            {expanded === scan.id && scan.events.length === 0 && (
              <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-400 bg-gray-50">
                No timeline events yet.
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  )
}
