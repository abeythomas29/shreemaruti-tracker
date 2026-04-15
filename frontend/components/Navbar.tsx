import { useRouter } from 'next/router'
import Link from 'next/link'
import { Package, History, Settings, LogOut } from 'lucide-react'

export default function Navbar() {
  const router = useRouter()

  const logout = () => {
    localStorage.removeItem('token')
    router.push('/login')
  }

  const linkClass = (path: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      router.pathname === path
        ? 'bg-brand-100 text-brand-700'
        : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-brand-700">
          <Package size={20} />
          <span>Courier Track AI</span>
        </Link>

        <div className="flex items-center gap-1">
          <Link href="/dashboard" className={linkClass('/dashboard')}>
            <Package size={16} /> Track
          </Link>
          <Link href="/history" className={linkClass('/history')}>
            <History size={16} /> History
          </Link>
          <Link href="/settings" className={linkClass('/settings')}>
            <Settings size={16} /> Settings
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors ml-2"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
