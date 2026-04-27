import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyAr8AvqL0sJ4Ro9gLTb-zxr7WiATDtm4nw',
  authDomain: 'vanishwhisper.firebaseapp.com',
  projectId: 'vanishwhisper',
  storageBucket: 'vanishwhisper.firebasestorage.app',
  messagingSenderId: '747274092976',
  appId: '1:747274092976:web:fd08cd1407fa2cd76c9675',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
