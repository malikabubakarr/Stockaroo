"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, collection, addDoc, query, where, onSnapshot } from "firebase/firestore";
import Link from "next/link";

interface Branch {
  id: string;
  shopName: string;
  ownerId: string;
}

export default function AddEmployee() {

const [ownerName, setOwnerName] = useState("");
const [ownerId, setOwnerId] = useState("");

const [branches, setBranches] = useState<Branch[]>([]);
const [selectedBranch, setSelectedBranch] = useState("");

const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");

useEffect(() => {

const unsubscribe = onAuthStateChanged(auth, async (user) => {

if (!user) return;

const ownerId = user.uid;
setOwnerId(ownerId);

const userDoc = await getDoc(doc(db,"users",ownerId));

if(userDoc.exists()){
setOwnerName(userDoc.data().name || "Owner");
}

const q = query(
collection(db,"branches"),
where("ownerId","==",ownerId)
);

const unsubBranches = onSnapshot(q,(snap)=>{

const list = snap.docs.map((doc)=>({
id:doc.id,
...doc.data()
})) as Branch[];

setBranches(list);

if(list.length > 0 && !selectedBranch){
setSelectedBranch(list[0].id);
}

});

return ()=>unsubBranches();

});

return ()=>unsubscribe();

},[]);


const addEmployee = async ()=>{

if(!name || !email || !password || !selectedBranch){
alert("Fill all fields");
return;
}

try{

const cred = await createUserWithEmailAndPassword(auth,email,password);

const uid = cred.user.uid;

const branch = branches.find(b=>b.id === selectedBranch);

await addDoc(collection(db,"employees"),{
uid,
name,
email,
role:"employee",
ownerId,
ownerName,
branchId:selectedBranch,
branchName:branch?.shopName,
createdAt:new Date()
});

alert("Employee added");

setName("");
setEmail("");
setPassword("");

}catch(err:any){
alert(err.message);
}

};

return(

<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">

<div className="w-full max-w-md">

  <div className="text-center">
        {/* Dashboard Button */}
<div className="mb-4 text-right">
<Link 
href="/owner-dashboard" 
className="inline-flex items-center px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all duration-300 border border-white/20 backdrop-blur-sm"
>
<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
<path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
</svg>
Dashboard
</Link>
</div>
</div>

<div className="text-center mb-8">
<h1 className="text-3xl font-bold text-white">Add Employee</h1>
<p className="text-gray-400 text-sm mt-1">
Create staff account
</p>
</div>

<div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 space-y-4">

<div className="text-center text-gray-300 text-sm space-y-1">

<p>
<span className="font-semibold text-white">Owner:</span> {ownerName}
</p>

{selectedBranch && (
<p>
<span className="font-semibold text-white">Branch:</span>{" "}
{branches.find(b=>b.id === selectedBranch)?.shopName}
</p>
)}

</div>

<select
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none"
value={selectedBranch}
onChange={(e)=>setSelectedBranch(e.target.value)}
>

{branches.map(branch=>(
<option key={branch.id} value={branch.id} className="text-black">
{branch.shopName}
</option>
))}

</select>

<input
placeholder="Employee Name"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none"
value={name}
onChange={(e)=>setName(e.target.value)}
/>

<input
placeholder="Email"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none"
value={email}
onChange={(e)=>setEmail(e.target.value)}
/>

<input
placeholder="Password"
type="password"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none"
value={password}
onChange={(e)=>setPassword(e.target.value)}
/>

<button
onClick={addEmployee}
className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300"
>
Add Employee
</button>

</div>

</div>

</div>

);

}