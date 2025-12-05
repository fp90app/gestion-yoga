// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBqlYXify9CDjqdYuCLBuAd7W76_Xd43Yg",
    authDomain: "gestion-yoga.firebaseapp.com",
    projectId: "gestion-yoga",
    storageBucket: "gestion-yoga.firebasestorage.app",
    messagingSenderId: "258116537790",
    appId: "1:258116537790:web:f15de802569b5a4f22fdef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);