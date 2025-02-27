import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your Firebase configuration

const firebaseConfig = window.env.firebaseConfig;

if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.error('Firebase configuration is missing. Check your environment variables.');
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Add Google Classroom scope to the provider
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');

// Authentication functions
export const signInWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      
      // Get Google access token
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential.accessToken;
      
      // Store the token for Google Classroom API calls
      localStorage.setItem('googleClassroomToken', token);
      
      return result.user;
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
};

export const logOut = async () => {
  try {
    await signOut(auth);
    localStorage.removeItem('googleClassroomToken');
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};

export { auth, db };