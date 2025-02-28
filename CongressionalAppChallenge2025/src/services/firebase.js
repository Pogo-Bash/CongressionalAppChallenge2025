import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithRedirect, 
  signInWithPopup,  // Added this import
  getRedirectResult, // Added this import
  onAuthStateChanged, // Added this import
  signOut 
} from 'firebase/auth';
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

// Helper function to extract and store token
function extractAndStoreToken(result) {
  try {
    console.log('Extracting token from auth result');
    
    if (!result) {
      console.error('No result provided');
      return false;
    }
    
    // Get the credential from the result
    const credential = GoogleAuthProvider.credentialFromResult(result);
    
    if (!credential) {
      console.error('No credential in auth result');
      return false;
    }
    
    const token = credential.accessToken;
    
    if (!token) {
      console.error('No access token in credential');
      return false;
    }
    
    // Store the token
    localStorage.setItem('googleClassroomToken', token);
    console.log('Successfully stored Google Classroom token');
    
    return true;
  } catch (error) {
    console.error('Error extracting token:', error);
    return false;
  }
}

// Authentication functions
export const signInWithGoogle = async () => {
    try {
      // First try with popup (often works better in Electron)
      console.log('Starting Google sign-in with popup...');
      
      try {
        const result = await signInWithPopup(auth, googleProvider);
        console.log('Sign-in successful with popup:', result.user);
        
        // Extract and store token
        const tokenSaved = extractAndStoreToken(result);
        console.log('Token saved successfully:', tokenSaved);
        
        return result.user;
      } catch (popupError) {
        console.error('Popup sign-in failed, trying redirect:', popupError);
        
        if (popupError.code === 'auth/popup-blocked' || 
            popupError.code === 'auth/cancelled-popup-request' ||
            popupError.code === 'auth/popup-closed-by-user') {
          // If popup is blocked, try redirect
          await signInWithRedirect(auth, googleProvider);
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
    console.log('Signed out and removed token from localStorage');
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};

export const handleRedirectResult = async () => {
    try {
      console.log('Checking for redirect result');
      const result = await getRedirectResult(auth);
      
      if (result) {
        // User successfully signed in
        console.log('User signed in via redirect:', result.user);
        
        // Extract and store token
        const tokenSaved = extractAndStoreToken(result);
        console.log('Token saved from redirect:', tokenSaved);
        
        return result.user;
      } else {
        console.log('No redirect result found');
      }
      
      return null;
    } catch (error) {
      console.error('Error handling redirect result:', error);
      return null;
    }
};

export { auth, db };