"use client";

import { useState } from "react";
import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, addDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function SignupPage() {

const [name,setName] = useState("")
const [email,setEmail] = useState("")
const [password,setPassword] = useState("")
const [shop,setShop] = useState("")
const [loading,setLoading] = useState(false)

const router = useRouter()

const signup = async ()=>{

try{

if(!name || !email || !password || !shop){
alert("Please fill all fields")
return
}

setLoading(true)

const userCredential = await createUserWithEmailAndPassword(auth,email,password)

const uid = userCredential.user.uid

await setDoc(doc(db,"users",uid),{
name,
email,
role:"owner",
createdAt:new Date()
})

await addDoc(collection(db,"branches"),{
shopName:shop,
ownerId:uid,
currency:"PKR",
currencySymbol:"₨",
isMain:true,
createdAt:new Date()
})

router.push("/owner-dashboard")

}catch(error:any){

alert(error.message)

}

setLoading(false)

}

return(

<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">

<div className="w-full max-w-md">

{/* Logo */}
<div className="flex flex-col items-center mb-8">
<Image
src="/stockaro-logo.png"
alt="Stockaroo"
width={70}
height={70}
className="rounded-xl shadow-xl"
/>

<h1 className="text-3xl font-bold text-white mt-3 tracking-tight">
Stockaroo
</h1>

<p className="text-gray-400 text-sm">
Create your shop account
</p>
</div>

{/* Card */}
<div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 space-y-4">

<input
placeholder="Owner Name"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={name}
onChange={e=>setName(e.target.value)}
/>

<input
placeholder="Email"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={email}
onChange={e=>setEmail(e.target.value)}
/>

<input
placeholder="Password"
type="password"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={password}
onChange={e=>setPassword(e.target.value)}
/>

<input
placeholder="Main Shop Name"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={shop}
onChange={e=>setShop(e.target.value)}
/>

<button
onClick={signup}
disabled={loading}
className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300"
>
{loading ? "Creating Account..." : "Create Shop"}
</button>

</div>

<p className="text-center text-gray-400 text-sm mt-6">
Already have an account?  
<span
onClick={()=>router.push("/login")}
className="text-white ml-2 cursor-pointer hover:underline"
>
Login
</span>
</p>

</div>

</div>

)
}