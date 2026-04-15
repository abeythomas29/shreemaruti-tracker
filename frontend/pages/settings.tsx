import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import { Key, CreditCard, User, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react'
import Navbar from '../components/Navbar'
import API from '../lib/api'

interface UserProfile {
  id: number
  email: string
  full_name: string
  subscription_status: string
  has_api_key: boolean
}

export default function Settings() {
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [removingKey, setRemovingKey] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('token')) { router.replace('/login'); return }
    API.get<UserProfile>('/auth/me').then(r => setUser(r.data)).catch(() => router.replace('/login'))

    if (router.query.subscription === 'canceled') {
      toast('Subscription was not completed.', { icon: 'ℹ️' })
    }
  }, [router])

  const saveKey = async () => {
    if (!apiKey.startsWith('sk-')) {
      toast.error('API key must start with sk-')
      return
    }
    setSavingKey(true)
    try {
      await API.put('/settings/api-key', { api_key: apiKey })
      setUser(prev => prev ? { ...prev, has_api_key: true } : prev)
      setApiKey('')
      toast.success('API key saved')
    } catch {
      toast.error('Failed to save API key')
    } finally {
      setSavingKey(false)
    }
  }

  const removeKey = async () => {
    setRemovingKey(true)
    try {
      await API.delete('/settings/api-key')
      setUser(prev => prev ? { ...prev, has_api_key: false } : prev)
      toast.success('API key removed')
    } catch {
      toast.error('Failed to remove key')
    } finally {
      setRemovingKey(false)
    }
  }

  const subscribe = async () => {
    setSubscribing(true)
    try {
      const { data } = await API.post<{ checkout_url: string }>('/payments/checkout')
      window.location.href = data.checkout_url
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Could not start checkout')
      setSubscribing(false)
    }
  }

  const manageSubscription = async () => {
    try {
      const { data } = await API.post<{ checkout_url: string }>('/payments/portal')
      window.location.href = data.checkout_url
    } catch {
      toast.error('Could not open billing portal')
    }
  }

  if (!user) return null

  const isActive = user.subscription_status === 'active'

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Profile */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <User size={18} className="text-brand-600" />
            <h2 className="font-semibold text-gray-900">Profile</h2>
          </div>
          <div className="space-y-1 text-sm text-gray-700">
            <p><span className="text-gray-400">Name:</span> {user.full_name}</p>
            <p><span className="text-gray-400">Email:</span> {user.email}</p>
          </div>
        </div>

        {/* Subscription */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard size={18} className="text-brand-600" />
            <h2 className="font-semibold text-gray-900">Subscription</h2>
          </div>

          {isActive ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-xl px-4 py-3 text-sm font-medium">
                <CheckCircle size={16} /> Pro plan active — unlimited AI scans included
              </div>
              <button onClick={manageSubscription} className="btn-secondary text-sm">
                Manage / cancel subscription
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-gray-500 bg-gray-50 rounded-xl px-4 py-3 text-sm">
                <AlertCircle size={16} /> Free plan — add your own API key below to scan receipts
              </div>
              <div className="border border-brand-200 bg-brand-50 rounded-xl p-4">
                <p className="font-semibold text-gray-900">Pro — $10/month</p>
                <p className="text-sm text-gray-500 mt-1 mb-3">No API key needed. Unlimited scans, powered by our platform.</p>
                <button onClick={subscribe} disabled={subscribing} className="btn-primary text-sm">
                  {subscribing ? 'Redirecting to Stripe…' : 'Subscribe now'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* API Key */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <Key size={18} className="text-brand-600" />
            <h2 className="font-semibold text-gray-900">Your OpenAI API Key</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Add your own key to scan for free. Your key is used only for your scans.
          </p>

          {user.has_api_key ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-xl px-4 py-3 text-sm font-medium">
                <CheckCircle size={16} /> API key saved (sk-…••••••)
              </div>
              <button onClick={removeKey} disabled={removingKey} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
                {removingKey ? 'Removing…' : 'Remove API key'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-proj-…"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button onClick={saveKey} disabled={savingKey || !apiKey} className="btn-primary text-sm">
                {savingKey ? 'Saving…' : 'Save API key'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
