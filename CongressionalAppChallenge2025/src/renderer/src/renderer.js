// Remove duplicate imports - you're importing authService but also defining it in this file
import { themeManager } from './theme-manager.js';

// For communication with Electron main process
const { ipcRenderer } = window.electron || {};

// Firebase configuration from environment variables
const firebaseConfig = window.env?.firebaseConfig || {};

// Log that we're using environment variables (without exposing the actual values)
console.log('Using Firebase config from environment variables:', 
  Object.keys(firebaseConfig).filter(key => !!firebaseConfig[key]).length + ' values configured');

// Import Firebase modules
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  onAuthStateChanged, 
  signOut,
  getRedirectResult
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Initialize Firebase
let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
}

// Add Google Classroom scopes to the provider
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');

// Authentication functions
const signInWithGoogle = async () => {
  try {
    // Instead of popup, use redirect for better compatibility with Electron
    console.log('Starting Google sign-in with redirect...');
    await signInWithRedirect(auth, googleProvider);
    // Code after this won't execute immediately due to redirect
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

const logOut = async () => {
  try {
    await signOut(auth);
    localStorage.removeItem('googleClassroomToken');
    console.log('Sign out successful');
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};

// Handle the redirect result from Google sign-in
const handleRedirectResult = async () => {
  if (!auth) return null;
  
  try {
    console.log('Checking for redirect result...');
    const result = await getRedirectResult(auth);
    
    if (result) {
      console.log('User signed in via redirect:', result.user);
      
      // Get the Google access token
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential.accessToken;
      
      // Store token for Google Classroom API calls
      localStorage.setItem('googleClassroomToken', token);
      console.log('Token stored successfully:', !!token);
      
      return result.user;
    } else {
      console.log('No redirect result');
      return null;
    }
  } catch (error) {
    console.error('Error handling redirect result:', error);
    alert(`Authentication error: ${error.message}`);
    return null;
  }
};

// Auth Service - this should be the only instance of authService in the app
const authService = {
  user: null,
  authListeners: [],
  
  async login() {
    try {
      console.log('Login requested');
      return await signInWithGoogle();
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  },
  
  async logout() {
    try {
      await logOut();
    } catch (error) {
      console.error("Logout error:", error);
      throw error;
    }
  },
  
  getCurrentUser() {
    return this.user;
  },
  
  isLoggedIn() {
    return !!this.user;
  },
  
  addAuthListener(callback) {
    this.authListeners.push(callback);
    // Immediately call with current state
    callback(this.user);
    return () => {
      this.authListeners = this.authListeners.filter(cb => cb !== callback);
    };
  },
  
  notifyListeners() {
    this.authListeners.forEach(callback => callback(this.user));
  }
};

// Google Classroom Service
const classroomService = {
  baseUrl: 'https://classroom.googleapis.com/v1',
  courseData: null,
  
  getToken() {
    return localStorage.getItem('googleClassroomToken');
  },
  
  async fetchCourses() {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated with Google Classroom');
    }
    
    try {
      console.log('Fetching Google Classroom courses...');
      const response = await fetch(`${this.baseUrl}/courses?courseStates=ACTIVE`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch courses: ${response.status}`);
      }
      
      const data = await response.json();
      this.courseData = data.courses || [];
      console.log('Courses fetched:', this.courseData);
      return this.courseData;
    } catch (error) {
      console.error('Error fetching Google Classroom courses:', error);
      
      // Handle token expired error
      if (error.message.includes('401')) {
        localStorage.removeItem('googleClassroomToken');
        throw new Error('Google Classroom session expired. Please sign in again.');
      }
      
      throw error;
    }
  },
  
  async fetchCourseWork(courseId) {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated with Google Classroom');
    }
    
    try {
      console.log(`Fetching coursework for course ${courseId}...`);
      const response = await fetch(`${this.baseUrl}/courses/${courseId}/courseWork`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch coursework: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Coursework fetched:', data.courseWork);
      return data.courseWork || [];
    } catch (error) {
      console.error(`Error fetching coursework for course ${courseId}:`, error);
      
      // Handle token expired error
      if (error.message.includes('401')) {
        localStorage.removeItem('googleClassroomToken');
        throw new Error('Google Classroom session expired. Please sign in again.');
      }
      
      throw error;
    }
  },
  
  getCourseData() {
    return this.courseData;
  }
};

// Initialize the application
async function initApp() { 
  console.log('Initializing application...');
  
  try {
    // First check for any redirect results
    await handleRedirectResult();
    
    // Then initialize the rest of the app
    themeManager.initialize();
    createFocusChart();
    initNavigation();
    initSettings();
    initializeAuth();
    initWindowControls();
  } catch (error) {
    console.error('Error during app initialization:', error);
  }
}

// Set up Firebase auth state listener
if (auth) {
  onAuthStateChanged(auth, (user) => {
    console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');
    if (user) {
      console.log('User details:', {
        displayName: user.displayName,
        email: user.email,
        uid: user.uid
      });
    }
    
    authService.user = user;
    authService.notifyListeners();
    
    // Update UI directly
    updateUIForSignedInUser(user);
  });
}

function initializeAuth() {
  const userSection = document.getElementById('user-section');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const curriculumLoginButton = document.getElementById('curriculum-login-button');
  
  console.log('Auth elements:', {
    userSection: !!userSection,
    userAvatar: !!userAvatar,
    userName: !!userName,
    loginButton: !!loginButton,
    logoutButton: !!logoutButton,
    curriculumLoginButton: !!curriculumLoginButton
  });
  
  // Handle login clicks
  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      console.log('Login button clicked');
      try {
        await authService.login();
      } catch (error) {
        console.error('Login failed:', error);
        alert(`Login failed: ${error.message}`);
      }
    });
  }
  
  if (curriculumLoginButton) {
    curriculumLoginButton.addEventListener('click', async () => {
      console.log('Curriculum login button clicked');
      try {
        await authService.login();
      } catch (error) {
        console.error('Login failed:', error);
        alert(`Login failed: ${error.message}`);
      }
    });
  }
  
  // Handle logout
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      console.log('Logout button clicked');
      try {
        await authService.logout();
      } catch (error) {
        console.error('Logout failed:', error);
        alert(`Logout failed: ${error.message}`);
      }
    });
  }
  
  // Listen for auth state changes
  authService.addAuthListener((user) => {
    if (!userSection || !loginButton) return;
    
    if (user) {
      // User is signed in
      console.log('User is signed in, updating UI');
      userSection.style.display = 'flex';
      loginButton.style.display = 'none';
      
      // Update user info
      if (userAvatar) userAvatar.src = user.photoURL || './assets/default-avatar.png';
      if (userName) userName.textContent = user.displayName || user.email;
      
      // Load Google Classroom data if on curriculum section
      const curriculumSection = document.getElementById('curriculum-section');
      if (curriculumSection && curriculumSection.classList.contains('active')) {
        loadCurriculumData();
      }
    } else {
      // User is signed out
      console.log('User is signed out, updating UI');
      userSection.style.display = 'none';
      loginButton.style.display = 'flex';
      
      // Reset curriculum section
      const curriculumContent = document.getElementById('curriculum-content');
      const curriculumNotLoggedIn = document.getElementById('curriculum-not-logged-in');
      const curriculumLoading = document.getElementById('curriculum-loading');
      
      if (curriculumContent) curriculumContent.style.display = 'none';
      if (curriculumNotLoggedIn) curriculumNotLoggedIn.style.display = 'block';
      if (curriculumLoading) curriculumLoading.style.display = 'none';
    }
  });
}

// Debug helper function for UI updates
function updateUIForSignedInUser(user) {
  if (!user) return;
  
  console.log('Updating UI for signed in user', user);
  
  const userSection = document.getElementById('user-section');
  const loginButton = document.getElementById('login-button');
  
  console.log('UI elements:', {
    userSection: userSection ? 'found' : 'missing',
    loginButton: loginButton ? 'found' : 'missing'
  });
  
  if (userSection && loginButton) {
    userSection.style.display = 'flex';
    loginButton.style.display = 'none';
    
    // Update user info if elements exist
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    
    if (userAvatar) {
      userAvatar.src = user.photoURL || './assets/default-avatar.png';
      console.log('Set avatar to:', userAvatar.src);
    }
    
    if (userName) {
      userName.textContent = user.displayName || user.email;
      console.log('Set username to:', userName.textContent);
    }
  }
}

// Load curriculum data from Google Classroom
async function loadCurriculumData() {
  if (!authService.isLoggedIn()) {
    console.log('Not logged in, cannot load curriculum data');
    return;
  }
  
  const loadingIndicator = document.getElementById('curriculum-loading');
  const curriculumContent = document.getElementById('curriculum-content');
  const notLoggedIn = document.getElementById('curriculum-not-logged-in');
  const coursesContainer = document.getElementById('courses-container');
  
  if (!loadingIndicator || !curriculumContent || !notLoggedIn || !coursesContainer) {
    console.error('Required curriculum DOM elements not found');
    return;
  }
  
  // Show loading, hide other sections
  loadingIndicator.style.display = 'flex';
  curriculumContent.style.display = 'none';
  notLoggedIn.style.display = 'none';
  
  try {
    console.log('Loading curriculum data...');
    const token = classroomService.getToken();
    if (!token) {
      throw new Error('No access token found. Please sign in again.');
    }
    
    console.log('Fetching courses with token...');
    const courses = await classroomService.fetchCourses();
    
    // Clear existing courses
    coursesContainer.innerHTML = '';
    
    if (!courses || courses.length === 0) {
      console.log('No courses found, showing empty state');
      coursesContainer.innerHTML = `
        <div class="empty-state">
          <p>No active courses found in your Google Classroom account.</p>
          <p>Make sure you have active courses in Google Classroom and that you've granted the necessary permissions.</p>
          <button class="primary-button" id="retry-classroom">
            <span class="material-icons">refresh</span>
            Retry
          </button>
        </div>
      `;
      
      document.getElementById('retry-classroom')?.addEventListener('click', () => {
        loadCurriculumData();
      });
    } else {
      console.log(`Displaying ${courses.length} courses`);
      // Display each course
      courses.forEach(course => {
        const courseCard = document.createElement('div');
        courseCard.className = 'course-card';
        courseCard.innerHTML = `
          <div class="course-name">${course.name}</div>
          <div class="course-section">${course.section || ''}</div>
          <div class="course-description">${course.description || 'No description available'}</div>
        `;
        
        // Add click handler to view course details
        courseCard.addEventListener('click', () => {
          viewCourseDetails(course.id);
        });
        
        coursesContainer.appendChild(courseCard);
      });
    }
    
    // Hide loading, show content
    loadingIndicator.style.display = 'none';
    curriculumContent.style.display = 'block';
  } catch (error) {
    console.error('Error loading curriculum data:', error);
    
    // Show error state
    loadingIndicator.style.display = 'none';
    curriculumContent.style.display = 'block';
    coursesContainer.innerHTML = `
      <div class="error-state">
        <p>Error loading your Google Classroom courses: ${error.message}</p>
        <button class="primary-button" id="retry-classroom">
          <span class="material-icons">refresh</span>
          Retry
        </button>
        <button class="secondary-button" id="relogin-classroom">
          <span class="material-icons">login</span>
          Sign In Again
        </button>
      </div>
    `;
    
    document.getElementById('retry-classroom')?.addEventListener('click', () => {
      loadCurriculumData();
    });
    
    document.getElementById('relogin-classroom')?.addEventListener('click', async () => {
      try {
        localStorage.removeItem('googleClassroomToken');
        await authService.login();
      } catch (loginError) {
        console.error('Failed to re-login:', loginError);
        alert(`Failed to sign in: ${loginError.message}`);
      }
    });
  }
}

async function viewCourseDetails(courseId) {
  // Implementation for viewing course work and details
  try {
    const courseWork = await classroomService.fetchCourseWork(courseId);
    
    // Create a modal to display course work
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Course Details</h2>
          <button class="close-button">&times;</button>
        </div>
        <div class="modal-body">
          <h3>Assignments and Materials</h3>
          <div class="coursework-list">
            ${courseWork.length === 0 ? 
              '<p class="empty-state">No assignments or materials found for this course.</p>' : 
              courseWork.map(item => `
                <div class="coursework-item">
                  <div class="coursework-title">${item.title}</div>
                  <div class="coursework-description">${item.description || ''}</div>
                  <div class="coursework-type">Type: ${item.workType || 'Not specified'}</div>
                  ${item.dueDate ? 
                    `<div class="coursework-due">Due: ${formatDate(item.dueDate)}</div>` : 
                    ''}
                </div>
              `).join('')}
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listener to close button
    modal.querySelector('.close-button').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    });
  } catch (error) {
    console.error('Error loading course details:', error);
    alert(`Error loading course details: ${error.message}`);
  }
}

// Helper function to format date
function formatDate(dateObj) {
  if (!dateObj) return 'No due date';
  
  try {
    const date = new Date(
      dateObj.year,
      (dateObj.month || 1) - 1,
      dateObj.day || 1
    );
    
    return date.toLocaleDateString();
  } catch (e) {
    return 'Invalid date';
  }
}

// For the chart (Placeholder)
function createFocusChart() {
  const chartElement = document.getElementById('focus-chart');
  if (!chartElement) return;
  
  const chartHTML = `
    <div class="chart-placeholder">
      <svg width="100%" height="100%" viewBox="0 0 800 300">
        <!-- Chart grid -->
        <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="50" x2="800" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        
        <!-- Chart data - Focus level line -->
        <path d="M0,200 Q100,180 200,150 T400,100 T600,170 T800,120" fill="none" stroke="#3366ff" stroke-width="3"/>
        
        <!-- Chart data - Previous period line -->
        <path d="M0,180 Q100,200 200,220 T400,150 T600,190 T800,170" fill="none" stroke="#ff9966" stroke-width="3" stroke-dasharray="5,5"/>
        
        <!-- X-axis labels -->
        <text x="0" y="270" fill="#b0b7c3" font-size="12">Mon</text>
        <text x="133" y="270" fill="#b0b7c3" font-size="12">Tue</text>
        <text x="266" y="270" fill="#b0b7c3" font-size="12">Wed</text>
        <text x="399" y="270" fill="#b0b7c3" font-size="12">Thu</text>
        <text x="532" y="270" fill="#b0b7c3" font-size="12">Fri</text>
        <text x="665" y="270" fill="#b0b7c3" font-size="12">Sat</text>
        <text x="798" y="270" fill="#b0b7c3" font-size="12">Sun</text>
        
        <!-- Legend -->
        <circle cx="650" cy="20" r="5" fill="#3366ff"/>
        <text x="660" y="25" fill="#ffffff" font-size="12">This week</text>
        <circle cx="740" cy="20" r="5" fill="#ff9966"/>
        <text x="750" y="25" fill="#ffffff" font-size="12">Last week</text>
      </svg>
    </div>
  `;
  
  chartElement.innerHTML = chartHTML;
}

// Initialize Navigation
function initNavigation() {
  console.log('Initializing navigation...');
  
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and sections
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
      
      // Add active class to clicked button and corresponding section
      button.classList.add('active');
      const sectionId = button.dataset.section + '-section';
      const section = document.getElementById(sectionId);
      
      if (section) {
        section.classList.add('active');
        
        // If switching to curriculum section, load data
        if (sectionId === 'curriculum-section' && authService.isLoggedIn()) {
          loadCurriculumData();
        }
      } else {
        console.error(`Section with ID "${sectionId}" not found`);
      }
    });
  });
}

// Initialize Settings
function initSettings() {
  console.log('Initializing settings...');
  
  // Theme options
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.dataset.theme;
      document.querySelectorAll('.theme-option').forEach(btn => btn.classList.remove('active'));
      option.classList.add('active');
      themeManager.setTheme(theme);
    });
  });

  // Theme toggle button
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    themeManager.toggleTheme();
  });

  // Connect Classroom button - use auth service login
  document.getElementById('connect-classroom')?.addEventListener('click', async () => {
    console.log('Connecting to Google Classroom...');
    try {
      await authService.login();
    } catch (error) {
      console.error('Failed to connect to Google Classroom:', error);
      alert(`Failed to connect to Google Classroom: ${error.message}`);
    }
  });
}

// Window control buttons
function initWindowControls() {
  console.log('Initializing window controls...');
  
  // Set up window control buttons
  if (ipcRenderer) {
    document.getElementById('minimize')?.addEventListener('click', () => {
      console.log('Minimize button clicked');
      ipcRenderer.send('window-control', 'minimize');
    });

    document.getElementById('maximize')?.addEventListener('click', () => {
      console.log('Maximize button clicked');
      ipcRenderer.send('window-control', 'maximize');
    });

    document.getElementById('close')?.addEventListener('click', () => {
      console.log('Close button clicked');
      ipcRenderer.send('window-control', 'close');
    });
  } else {
    console.warn('IPC Renderer not available - window controls will not function');
  }
}

// Call initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing application...');
  
  // Debug logging for button detection
  console.log('Login button:', document.getElementById('login-button'));
  console.log('Curriculum login button:', document.getElementById('curriculum-login-button'));
  
  console.log('All buttons on the page:');
  document.querySelectorAll('button').forEach((button, index) => {
    console.log(`Button ${index}:`, button, 'ID:', button.id);
  });
  
  // Initialize the application
  initApp();
});

// Export services for use in other modules
export { authService, classroomService, handleRedirectResult };