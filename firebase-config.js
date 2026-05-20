// Firebase SDK imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCOHHzitgcljAeLkklaty_C7ndmZGJqZ2Y",
  authDomain: "jury-exhibition-system.firebaseapp.com",
  projectId: "jury-exhibition-system",
  storageBucket: "jury-exhibition-system.firebasestorage.app",
  messagingSenderId: "469139258370",
  appId: "1:469139258370:web:bdba89ac06bc9612fb3b1b",
  measurementId: "G-4JV75Y9T2T"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// Export for use in other files
export { db, auth, analytics };