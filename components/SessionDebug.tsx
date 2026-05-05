"use client";
import { restorePOSSession } from "@/lib/auth";

export default function SessionDebug() {
  const session = restorePOSSession();
  
  if (!session) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-green-500 text-white p-2 rounded text-xs max-w-xs">
      <div>✅ 12hr Session Active</div>
      <div>Expires: {new Date(session.expiresAt).toLocaleString()}</div>
      <div>Role: {session.role}</div>
    </div>
  );
}