import { 
  auth, 
  signInWithGoogle, 
  logOut, 
  handleRedirectResult 
} from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';

class AuthService {
  constructor() {
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
    
    // Check for redirect result after constructor
    setTimeout(() => this.checkRedirectResult(), 0);
  }
  
  async checkRedirectResult() {
    try {
      const user = await handleRedirectResult();
      if (user) {
        this.user = user;
        this.notifyListeners();
        console.log('Updated user from redirect result');
      }
    } catch (error) {
      console.error('Failed to handle redirect:', error);
    }
  }
  
  async login() {
    try {
      console.log('Login requested');
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
    console.log('Notifying auth listeners, isLoggedIn:', !!this.user);
    this.authListeners.forEach(callback => callback(this.user));
  }
}

// Create and export a singleton instance
export const authService = new AuthService();