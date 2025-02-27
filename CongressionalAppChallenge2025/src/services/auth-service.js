import { auth, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

class AuthService {
  constructor() {
    this.user = null;
    this.authListeners = [];
    
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
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
}

// Create and export a singleton instance
export const authService = new AuthService();