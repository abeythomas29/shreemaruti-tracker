import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Package, Camera, Bell, Clock } from 'lucide-react'

export default function Landing() {
  const router = useRouter()

  useEffect(() => {
    if (localStorage.getItem('token')) router.replace('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-brand-700 text-lg">
          <Package size={22} /> Shree Maruti Tracker
        </div>
        <div className="flex gap-3">
          <Link href="/login" className="btn-secondary text-sm">Log in</Link>
          <Link href="/register" className="btn-primary text-sm">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-3xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
          <Camera size={14} /> AI-powered receipt scanning
        </div>
        <h1 className="text-5xl font-extrabold text-gray-900 leading-tight mb-4">
          Track any Shree Maruti<br />shipment in seconds
        </h1>
        <p className="text-lg text-gray-500 mb-10">
          Upload a photo of your courier receipt. Our AI reads the AWB number and
          instantly fetches your delivery status — no typing needed.
        </p>
        <Link href="/register" className="btn-primary text-base px-8 py-3">
          Start tracking for free
        </Link>
      </main>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-4 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { icon: Camera, title: 'Snap the receipt', desc: 'Take a photo or upload your Shree Maruti consignment note.' },
          { icon: Package, title: 'AI extracts AWB', desc: 'GPT-4o reads the tracking number — no manual entry.' },
          { icon: Bell, title: 'Live status & history', desc: 'See real-time status and your full delivery history.' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="card text-center">
            <div className="w-11 h-11 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Icon size={20} className="text-brand-700" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500">{desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="max-w-3xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">Simple pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card border-2 border-gray-200">
            <h3 className="font-bold text-gray-900 text-lg mb-1">Bring your own key</h3>
            <p className="text-3xl font-extrabold text-gray-900 mb-3">Free</p>
            <p className="text-sm text-gray-500 mb-4">Add your OpenAI API key in settings and pay only what you use.</p>
            <Link href="/register" className="btn-secondary block text-center text-sm">Get started</Link>
          </div>
          <div className="card border-2 border-brand-500 relative">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">Popular</span>
            <h3 className="font-bold text-gray-900 text-lg mb-1">Pro</h3>
            <p className="text-3xl font-extrabold text-gray-900 mb-3">$10<span className="text-base font-normal text-gray-500">/month</span></p>
            <p className="text-sm text-gray-500 mb-4">No API key needed. Unlimited scans powered by our platform key.</p>
            <Link href="/register" className="btn-primary block text-center text-sm">Subscribe</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
