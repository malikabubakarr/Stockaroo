"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePOSAuth } from "@/hooks/usePOSAuth"

export default function Home() {
  const router = useRouter()
  const { session, loading } = usePOSAuth()

  useEffect(() => {
    if (!loading) {
      if (session) {
        // 🚀 User has valid 12hr session → Dashboard
        router.push("/dashboard")
      } else {
        // No session → Login
        router.push("/login")
      }
    }
  }, [session, loading, router])

  // Show loading spinner while checking session
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return null
}