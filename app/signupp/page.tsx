"use client";

import Image from "next/image";
import Link from "next/link";

export default function ContactForAccount() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Image
              src="/stockaro-logo.png"
              alt="Stockaroo"
              width={100}
              height={100}
              className="rounded-2xl shadow-2xl"
              priority
            />
          </div>
          <h1 className="text-4xl font-black text-white mb-2">Stockaroo</h1>
          <p className="text-gray-400">Your Business Management Solution</p>
        </div>

        {/* Contact Card */}
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-white">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-emerald-500 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-4 shadow-xl">
              📞
            </div>
            <h2 className="text-2xl font-bold mb-2">Create Your Account</h2>
            <p className="text-gray-300 text-sm">
              To create a Stockaroo account for your shop, please contact our representative:
            </p>
          </div>

          {/* Contact Person */}
          <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                AM
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Abubakar Malik</h3>
                <p className="text-emerald-400 text-sm">Account Manager</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Phone */}
              <div 
                onClick={() => copyToClipboard("03124379997")}
                className="flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl p-3 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📱</span>
                  <div>
                    <p className="text-xs text-gray-400">Phone / WhatsApp</p>
                    <p className="font-mono font-semibold">0312-4379997</p>
                  </div>
                </div>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to copy
                </span>
              </div>

              {/* Email */}
              <div 
                onClick={() => copyToClipboard("abubkarrmalik383@gmail.com")}
                className="flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl p-3 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📧</span>
                  <div>
                    <p className="text-xs text-gray-400">Email</p>
                    <p className="font-mono font-semibold">abubkarrmalik383@gmail.com</p>
                  </div>
                </div>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to copy
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <a 
              href="tel:03124379997"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-4 px-4 rounded-xl transition-all duration-300 text-center flex items-center justify-center gap-2"
            >
              <span>📞</span> Call Now
            </a>
            <a 
              href="https://wa.me/923124379997"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-4 rounded-xl transition-all duration-300 text-center flex items-center justify-center gap-2"
            >
              <span>💬</span> WhatsApp
            </a>
          </div>

          {/* Email Direct */}
          <a 
            href="mailto:abubkarrmalik383@gmail.com?subject=Stockaroo%20Account%20Creation&body=Hello%20Abubakar%2C%0A%0AI%20would%20like%20to%20create%20a%20Stockaroo%20account%20for%20my%20shop.%20Please%20guide%20me%20through%20the%20process.%0A%0AShop%20Name%3A%20%0AContact%20Number%3A%20%0A"
            className="block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 text-center mb-6"
          >
            ✉️ Send Email Inquiry
          </a>

          {/* Info Box */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-sm text-emerald-400 text-center">
              ⚡ After contacting Abubakar, your account will be created within 24 hours. You'll receive login credentials via WhatsApp or Email.
            </p>
          </div>
        </div>

        {/* Back to Login */}
        <div className="text-center mt-6">
          <Link 
            href="/login" 
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← Back to Login
          </Link>
        </div>

      {/* Footer */}
      <div className="text-center mt-8">
        <div className="w-12 h-px bg-white/10 mx-auto mb-4"></div>
        <p className="text-gray-500 text-xs">
          © {new Date().getFullYear()} Stockaroo
        </p>
      </div>
    </div>
  </div>
);
}