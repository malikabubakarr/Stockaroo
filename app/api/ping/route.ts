// app/api/ping/route.ts - STOP THE 404s
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}