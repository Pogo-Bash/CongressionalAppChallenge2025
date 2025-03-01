import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithRedirect, 
  signInWithPopup,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
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

// Set persistence to local
setPersistence(auth, browserLocalPersistence)
  .then(() => console.log('Firebase persistence set to local'))
  .catch(error => console.error('Error setting persistence:', error));

const db = getFirestore(app);

// Add Google Classroom scope to the provider
const googleProvider = new GoogleAuthProvider();

if (firebaseConfig && firebaseConfig.clientId) {
  console.log('Client ID available:', firebaseConfig.clientId.substring(0, 8) + '...');
  googleProvider.setCustomParameters({
    client_id: firebaseConfig.clientId,
    prompt: 'consent',
    access_type: 'offline' // Request a refresh token
  });
} else {
  console.warn('No client ID found in the Firebase config!');
}

googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');

// Track authentication in progress to prevent multiple popups
let isAuthInProgress = false;

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

// Function to check if popups are allowed
function checkPopupBlocker() {
  try {
    const testPopup = window.open('about:blank', '_blank', 'width=1,height=1');
    
    if (!testPopup || testPopup.closed || typeof testPopup.closed === 'undefined') {
      console.warn('Popup blocker detected');
      return false;
    }
    
    testPopup.close();
    return true;
  } catch (e) {
    console.error('Error checking popup blocker', e);
    return false;
  }
}

// Authentication functions
export const signInWithSameAccount = async () => {
  if (isAuthInProgress) {
    console.log('Authentication already in progress, ignoring request');
    return null;
  }
  
  isAuthInProgress = true;
  
  try {
    console.log('Starting sign-in with same account');
    
    // Clear any existing token to ensure fresh authentication
    localStorage.removeItem('googleClassroomToken');
    
    const provider = new GoogleAuthProvider();
    
    // Add necessary scopes
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');
    
    // Set parameters for same account
    if (firebaseConfig && firebaseConfig.clientId) {
      provider.setCustomParameters({
        client_id: firebaseConfig.clientId,
        prompt: 'none',  // Try to use existing session
        access_type: 'offline'
      });
    } else {
      provider.setCustomParameters({
        prompt: 'none',
        access_type: 'offline'
      });
    }
    
    // Check for popup blockers
    if (!checkPopupBlocker()) {
      console.log('Popups are blocked, using redirect auth');
      await signInWithRedirect(auth, provider);
      return null;
    }
    
    // Try popup first
    try {
      const result = await signInWithPopup(auth, provider);
      console.log('Sign-in successful with popup');
      extractAndStoreToken(result);
      return result.user;
    } catch (popupError) {
      console.error('Popup sign-in failed:', popupError);
      
      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        console.log('Popup failed, trying redirect...');
        await signInWithRedirect(auth, provider);
        return null;
      } else {
        throw popupError;
      }
    }
  } catch (error) {
    console.error('Error in signInWithSameAccount:', error);
    throw error;
  } finally {
    // Reset the auth flag after a short delay
    setTimeout(() => {
      isAuthInProgress = false;
    }, 1000);
  }
};

export const signInWithNewAccount = async () => {
  if (isAuthInProgress) {
    console.log('Authentication already in progress, ignoring request');
    return null;
  }
  
  isAuthInProgress = true;
  
  try {
    console.log('Starting sign-in with new account');
    
    // Clear existing authentication
    localStorage.removeItem('googleClassroomToken');
    try {
      await signOut(auth);
    } catch (signOutError) {
      console.warn('Error signing out before new account auth:', signOutError);
      // Continue with sign-in anyway
    }
    
    const provider = new GoogleAuthProvider();
    
    // Add necessary scopes
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');
    
    // Set parameters to force account selection
    if (firebaseConfig && firebaseConfig.clientId) {
      provider.setCustomParameters({
        client_id: firebaseConfig.clientId,
        prompt: 'select_account',  // Force account selection
        access_type: 'offline'
      });
    } else {
      provider.setCustomParameters({
        prompt: 'select_account',
        access_type: 'offline'
      });
    }
    
    // Check for popup blockers
    if (!checkPopupBlocker()) {
      console.log('Popups are blocked, using redirect auth');
      await signInWithRedirect(auth, provider);
      return null;
    }
    
    // Try popup first
    try {
      const result = await signInWithPopup(auth, provider);
      console.log('Sign-in successful with popup');
      extractAndStoreToken(result);
      return result.user;
    } catch (popupError) {
      console.error('Popup sign-in failed:', popupError);
      
      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        console.log('Popup failed, trying redirect...');
        await signInWithRedirect(auth, provider);
        return null;
      } else {
        throw popupError;
      }
    }
  } catch (error) {
    console.error('Error in signInWithNewAccount:', error);
    throw error;
  } finally {
    // Reset the auth flag after a short delay
    setTimeout(() => {
      isAuthInProgress = false;
    }, 1000);
  }
};

// Legacy function for backward compatibility
export const signInWithGoogle = async (useSameAccount = true) => {
  if (useSameAccount) {
    return signInWithSameAccount();
  } else {
    return signInWithNewAccount();
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