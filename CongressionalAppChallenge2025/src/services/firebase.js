import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithRedirect, signOut } from 'firebase/auth';
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


export const signInWithGoogle = async () => {
    try {
      // Instead of signInWithPopup, we'll use signInWithRedirect
      await signInWithRedirect(auth, googleProvider);
      console.log('Sign-in redirect completed, processing result...');
      
      // Get Google access token
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential.accessToken;
      
      // Store the token for Google Classroom API calls
      localStorage.setItem('googleClassroomToken', token);
      console.log('Sign in successful, token stored');
      return null; // This will only return after the redirect completes
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

export const handleRedirectResult = async () => {
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        // User successfully signed in
        console.log('User signed in via redirect:', result.user);
        
        // Get the Google access token
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential.accessToken;
        
        // Store token for Google Classroom API calls
        localStorage.setItem('googleClassroomToken', token);
        
        return result.user;
      }
    } catch (error) {
      console.error('Error handling redirect result:', error);
      throw error;
    }
  };

export { auth, db, handleRedirectResult };