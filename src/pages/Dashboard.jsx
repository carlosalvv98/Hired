import { Briefcase } from 'lucide-react'

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <Briefcase className="mx-auto mb-4 text-indigo-600" size={48} />
        <h1 className="text-3xl font-bold text-gray-900">Hired</h1>
        <p className="mt-2 text-gray-500">Your job application tracker</p>
      </div>
    </div>
  )
}
