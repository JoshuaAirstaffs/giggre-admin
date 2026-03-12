import React from 'react'
import Dashboard from '@/app/dashboard/page'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
        <Dashboard>
            {children}
        </Dashboard>
    </div>
  )
}