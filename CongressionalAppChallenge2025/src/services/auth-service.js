import { auth, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

class AuthService {
  constructor() {

    this.handleRedirectResult();

    this.user = null;
    this.authListeners = [];
    
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {

    console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');

    if (user) {
        console.log('User details:', {
          displayName: user.displayName,
          email: user.email,
          uid: user.uid
        });
    }

    this.user = user;
    this.notifyListeners();
    });
  }
  
  async login() {
    try {
      const user = await signInWithGoogle();
      return user;
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  }
  
  async logout() {
    try {
      await logOut();
      // Clear any stored tokens
      localStorage.removeItem('googleClassroomToken');
    } catch (error) {
      console.error("Logout error:", error);
      throw error;
    }
  }
  
  getCurrentUser() {
    return this.user;
  }
  
  isLoggedIn() {
    return !!this.user;
  }
  
  addAuthListener(callback) {
    this.authListeners.push(callback);
    // Immediately call with current state
    callback(this.user);
    return () => {
      this.authListeners = this.authListeners.filter(cb => cb !== callback);
    };
  }
  
  notifyListeners() {
    this.authListeners.forEach(callback => callback(this.user));
  }

  async handleRedirectResult() {
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
  }
}

// Create and export a singleton instance
export const authService = new AuthService();