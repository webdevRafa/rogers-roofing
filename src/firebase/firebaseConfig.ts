// src/firebase/firebaseConfig.ts
// Firebase initialization for Vite + TypeScript using import.meta.env
// Exports: app, db (Firestore), storage, auth, googleProvider

import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {}),
} as const;

// Avoid re-initializing during hot reloads
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Core SDKs
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Persist auth state in the browser (tabs survive reload)
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* non-fatal if the environment (e.g., SSR) can't set persistence */
});

// Google provider (use with signInWithPopup/auth or signInWithRedirect)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
