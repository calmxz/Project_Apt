import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-adaptlearn',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-adaptlearn.appspot.com',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'demo-app-id',
}

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  const emulatorHost = import.meta.env.VITE_EMULATOR_HOST || 'localhost'
  connectFirestoreEmulator(db, emulatorHost, 8080)
  connectStorageEmulator(storage, emulatorHost, 9199)
  connectFunctionsEmulator(functions, emulatorHost, 5001)
}
