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

async function checkAuthStatus() {
    if (!auth) {
      console.log('Auth not initialized');
      return null;
    }
    
    return new Promise((resolve) => {
      // Add an observer for auth state changes
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        console.log('Initial auth state check:', user ? 'Signed in' : 'Signed out');
        unsubscribe(); // Unsubscribe after initial check
        resolve(user);
      });
    });
}

// Authentication functions
export const signInWithGoogle = async () => {
    try {
      // First try with popup (often works better in Electron)
      console.log('Starting Google sign-in with popup...');
      const provider = new GoogleAuthProvider();
      
      // Add Google Classroom scopes
      provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
      provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
      provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
      
      try {
        const result = await signInWithPopup(auth, provider);
        console.log('Sign-in successful with popup:', result.user);
        
        // Get Google access token
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential.accessToken;
        
        // Store token for Google Classroom API calls
        localStorage.setItem('googleClassroomToken', token);
        console.log('Access token stored in localStorage');
        
        // Force update UI
        updateUIForSignedInUser(result.user);
        
        return result.user;
      } catch (popupError) {
        console.error('Popup sign-in failed, trying redirect:', popupError);
        if (popupError.code === 'auth/popup-blocked') {
          // If popup is blocked, try redirect
          await signInWithRedirect(auth, provider);
          // Code after this won't execute immediately due to redirect
          return null;
        } else {
          throw popupError;
        }
      }
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