// Import theme manager
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

if (window.env.firebaseConfig.clientId) {
  googleProvider.setCustomParameters({
    client_id: window.env.firebaseConfig.clientId
  });
}

googleProvider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');

// Central UI update function
function updateUI(user) {
  console.log('Updating UI based on auth state:', user ? 'Signed in' : 'Signed out');
  
  const userSection = document.getElementById('user-section');
  const loginButton = document.getElementById('login-button');
  
  if (!userSection || !loginButton) {
    console.error('Required UI elements not found');
    return;
  }
  
  if (user) {
    // User is signed in
    console.log('User signed in, updating UI elements');
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
    
    // Check if we're in the curriculum section and load data
    const curriculumSection = document.getElementById('curriculum-section');
    if (curriculumSection && curriculumSection.classList.contains('active')) {
      loadCurriculumData();
    }
  } else {
    // User is signed out
    console.log('User signed out, updating UI elements');
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
}

// Legacy function for backward compatibility
function updateUIForSignedInUser(user) {
  if (!user) return;
  
  console.log('Updating UI for signed in user');
  
  // Just call our unified UI update function
  updateUI(user);
}

// Function to extract and store token
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
    
    console.log('Got credential type:', typeof credential);
    const token = credential.accessToken;
    
    if (!token) {
      console.error('No access token in credential');
      return false;
    }
    
    console.log('Token obtained, length:', token.length);
    
    // Store the token
    localStorage.setItem('googleClassroomToken', token);
    console.log('Token stored in localStorage');
    
    // Also log if it can be retrieved
    const storedToken = localStorage.getItem('googleClassroomToken');
    console.log('Token retrieved from storage, length:', storedToken ? storedToken.length : 0);
    
    return true;
  } catch (error) {
    console.error('Error extracting token:', error);
    return false;
  }
}

// Authentication functions
async function signInWithGoogle(useSameAccount = true) {
  try {
    console.log('Starting Google sign-in');
    
    // Configure the provider
    const provider = new GoogleAuthProvider();
    
    // Add Google Classroom scopes
    provider.addScope('https://www.googleapis.com/auth/classroom.courses.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.coursework.me.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.rosters.readonly');
    provider.addScope('https://www.googleapis.com/auth/classroom.profile.emails');

    // Set custom parameters
    if (window.env.firebaseConfig.clientId) {
      provider.setCustomParameters({
        client_id: window.env.firebaseConfig.clientId,
        prompt: useSameAccount ? 'none' : 'select_account', // Force account selection if needed
      });
    } else {
      provider.setCustomParameters({
        prompt: useSameAccount ? 'none' : 'select_account', // Force account selection if needed
      });
    }

    // Try popup first (works better in Electron)
    try {
      console.log('Attempting popup sign-in');
      const result = await signInWithPopup(auth, provider);
      console.log('Popup sign-in successful');
      
      // Extract and store token
      const tokenExtracted = extractAndStoreToken(result);
      console.log('Token extracted:', tokenExtracted);
      
      // Force UI update
      updateUI(result.user);
      
      return result.user;
    } catch (popupError) {
      console.error('Popup sign-in failed:', {
        code: popupError.code,
        message: popupError.message,
        email: popupError.email,
        credential: popupError.credential,
      });

      // If popup is blocked or fails, try redirect
      if (
        popupError.code === 'auth/popup-blocked' ||
        popupError.code === 'auth/cancelled-popup-request' ||
        popupError.code === 'auth/popup-closed-by-user'
      ) {
        console.log('Popup blocked or failed, trying redirect...');
        await signInWithRedirect(auth, provider);
        return null;
      } else {
        throw popupError;
      }
    }
  } catch (error) {
    console.error('Sign-in failed:', {
      code: error.code,
      message: error.message,
      email: error.email,
      credential: error.credential,
    });
    alert(`Sign-in failed: ${error.message}`);
    return null;
  }
}

function showAccountSelectionModal() {
  const modal = document.getElementById('account-modal');
  if (!modal) {
    console.error('Account selection modal not found in the DOM');
    return;
  }

  console.log('Showing account selection modal');
  modal.style.display = 'flex';

  // Handle "Use Same Account" button
  const useSameAccountButton = document.getElementById('use-same-account');
  if (!useSameAccountButton) {
    console.error('"Use Same Account" button not found');
  } else {
    useSameAccountButton.addEventListener('click', async () => {
      console.log('Use Same Account button clicked');
      modal.style.display = 'none';
      await signInWithGoogle(true); // Use same account
    });
  }

  // Handle "Use Another Account" button
  const useAnotherAccountButton = document.getElementById('use-another-account');
  if (!useAnotherAccountButton) {
    console.error('"Use Another Account" button not found');
  } else {
    useAnotherAccountButton.addEventListener('click', async () => {
      console.log('Use Another Account button clicked');
      modal.style.display = 'none';
      await signInWithGoogle(false); // Force account selection
    });
  }
}

// Modify your login button click handler to show the modal
document.getElementById('login-button')?.addEventListener('click', () => {
  console.log('Login button clicked');
  showAccountSelectionModal();
});

document.getElementById('curriculum-login-button')?.addEventListener('click', () => {
  console.log('Curriculum login button clicked');
  showAccountSelectionModal();
});

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

// Handle the redirect result from Google sign-in
const handleRedirectResult = async () => {
  if (!auth) {
    console.log('Auth not initialized, cannot handle redirect result');
    return null;
  }
  
  try {
    console.log('Checking for redirect result...');
    
    const result = await getRedirectResult(auth);
    
    if (result) {
      console.log('Successfully got redirect result');
      
      // Extract and store token
      const tokenSaved = extractAndStoreToken(result);
      console.log('Token saved from redirect:', tokenSaved);
      
      // Force update the UI
      updateUI(result.user);
      
      return result.user;
    } else {
      console.log('No redirect result found');
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
  
  async testToken() {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }
    
    try {
      // Make a simple API call to verify the token works
      const response = await fetch(`${this.baseUrl}/courses?pageSize=1`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token test failed:', errorText);
        
        if (response.status === 401) {
          // Token expired or invalid
          localStorage.removeItem('googleClassroomToken');
          throw new Error('Authentication token expired. Please sign in again.');
        }
        
        throw new Error(`API error: ${response.status}`);
      }
      
      console.log('Token test successful');
      return true;
    } catch (error) {
      console.error('Token test error:', error);
      throw error;
    }
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
        const errorText = await response.text();
        console.error('API error response:', errorText);
        
        if (response.status === 401) {
          localStorage.removeItem('googleClassroomToken');
          throw new Error('Authentication token expired. Please sign in again.');
        }
        
        throw new Error(`Failed to fetch courses: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Courses response data:', data);
      this.courseData = data.courses || [];
      
      if (!data.courses || data.courses.length === 0) {
        console.log('No courses found in the response');
      } else {
        console.log(`Found ${data.courses.length} courses`);
      }
      
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
        if (response.status === 401) {
          localStorage.removeItem('googleClassroomToken');
          throw new Error('Authentication token expired. Please sign in again.');
        }
        
        throw new Error(`Failed to fetch coursework: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Coursework fetched:', data.courseWork ? data.courseWork.length : 0);
      return data.courseWork || [];
    } catch (error) {
      console.error(`Error fetching coursework for course ${courseId}:`, error);
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
    // Check for redirect result first
    console.log('Checking for auth redirect result');
    const redirectUser = await handleRedirectResult();
    if (redirectUser) {
      console.log('User authenticated via redirect');
    }
    
    // Initialize theme
    themeManager.initialize();
    
    // Initialize UI elements
    createFocusChart();
    initNavigation();
    initSettings();
    initWindowControls();
    setupCheckboxListeners();
    
    // Initialize auth listeners
    initializeAuthUI();
    
    // Debug token status
    const token = localStorage.getItem('googleClassroomToken');
    console.log('Token exists on startup:', !!token);
    
    if (token) {
      try {
        // Verify token is still valid
        await classroomService.testToken();
        console.log('Token is valid');
      } catch (error) {
        console.warn('Token validation failed:', error.message);
        // Don't remove the token here, let the API call handle that
      }
    }
  } catch (error) {
    console.error('Error during app initialization:', error);
  }
}

async function testClassroomAPI() {
  const token = localStorage.getItem('googleClassroomToken');
  if (!token) {
    console.log('No token available for Classroom API test');
    return;
  }
  
  console.log('Testing Classroom API with token');
  try {
    const response = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      console.error('Classroom API test failed with status:', response.status);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return;
    }
    
    const data = await response.json();
    console.log('Classroom API test successful, courses:', data);
  } catch (error) {
    console.error('Classroom API test error:', error);
  }
}

// Set up Firebase auth state listener
if (auth) {
  onAuthStateChanged(auth, (user) => {
    console.log('Auth state changed:', user ? 'User signed in' : 'User signed out');
    
    // Update authService state
    authService.user = user;
    
    // Check token status whenever auth state changes
    if (user) {
      console.log('User signed in, checking token');
      const token = localStorage.getItem('googleClassroomToken');
      console.log('Token in localStorage:', !!token);
      
      if (!token) {
        console.warn('User is signed in but no token is available');
        // May need to re-authenticate in this case
      } else {
        testClassroomAPI();
      }
    }
    
    // Update UI
    updateUI(user);
    
    // Notify auth listeners
    authService.notifyListeners();
  });
}

function initializeAuthUI() {
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
  const generateButtonContainer = document.getElementById('generate-button-container') || 
    createGenerateButtonContainer();
  
  if (!loadingIndicator || !curriculumContent || !notLoggedIn || !coursesContainer) {
    console.error('Required curriculum DOM elements not found');
    return;
  }
  
  // Show loading, hide other sections
  loadingIndicator.style.display = 'flex';
  curriculumContent.style.display = 'none';
  notLoggedIn.style.display = 'none';
  generateButtonContainer.style.display = 'none';
  
  try {
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
      
      // Add a "Select All" option
      const selectAllContainer = document.createElement('div');
      selectAllContainer.className = 'select-all-container';
      selectAllContainer.innerHTML = `
        <label class="select-all-label">
          <input type="checkbox" id="select-all-courses" class="course-checkbox">
          <span>Select All Courses</span>
        </label>
      `;
      coursesContainer.appendChild(selectAllContainer);
      
      // Display each course with checkbox
      courses.forEach(course => {
        const courseCard = createCourseCard(course);
        coursesContainer.appendChild(courseCard);
      });
      
      // Add event listeners for checkboxes
      setupCheckboxListeners();
      
      // Add event listeners for view details buttons
      document.querySelectorAll('.view-details-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          const courseId = button.dataset.courseId;
          viewCourseDetails(courseId);
        });
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

function createCourseCard(course) {
  const courseCard = document.createElement('div');
  courseCard.className = 'course-card';
  courseCard.dataset.courseId = course.id;
  
  courseCard.innerHTML = `
    <div class="course-header">
      <label class="course-select" title="Select this course">
        <input type="checkbox" class="course-checkbox" data-course-id="${course.id}">
        <span class="checkmark"></span>
      </label>
      <div class="course-name">${course.name}</div>
    </div>
    <div class="course-section">${course.section || ''}</div>
    <div class="course-description">${course.description || 'No description available'}</div>
    <button class="view-details-btn" data-course-id="${course.id}">
      <span class="material-icons">visibility</span>
      View Details
    </button>
  `;
  
  return courseCard;
}

function createGenerateButtonContainer() {
  const curriculumSection = document.getElementById('curriculum-section');
  const container = document.createElement('div');
  container.id = 'generate-button-container';
  container.className = 'generate-button-container';
  container.style.display = 'none';
  
  if (curriculumSection) {
    curriculumSection.appendChild(container);
  }
  
  return container;
}

// Updated setupCheckboxListeners function to fix checkbox interactions
function setupCheckboxListeners() {
  // Select All checkbox
  const selectAllCheckbox = document.getElementById('select-all-courses');
  const courseCheckboxes = document.querySelectorAll('.course-checkbox:not(#select-all-courses)');
  
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function() {
      courseCheckboxes.forEach(checkbox => {
        checkbox.checked = this.checked;
      });
      updateGenerateButton();
    });
    
    // Make sure the label click is propagated to the checkbox
    const selectAllLabel = selectAllCheckbox.closest('.select-all-label');
    if (selectAllLabel) {
      selectAllLabel.addEventListener('click', (e) => {
        // This prevents the card click handler from toggling it again
        e.stopPropagation();
      });
    }
  }
  
  // Individual course checkboxes
  courseCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      updateGenerateButton();
      
      // Update "Select All" checkbox state
      if (selectAllCheckbox) {
        const allChecked = Array.from(courseCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(courseCheckboxes).some(cb => cb.checked);
        
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
    });
    
    // Make sure the label click is propagated to the checkbox
    const checkboxLabel = checkbox.closest('.course-select');
    if (checkboxLabel) {
      checkboxLabel.addEventListener('click', (e) => {
        // This prevents the card click handler from toggling it again
        e.stopPropagation();
      });
    }
  });
  
  // Update the card click handler to not trigger when clicking on buttons or labels
  document.querySelectorAll('.course-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Only handle card clicks if not clicking on a button, checkbox, or label
      if (
        !e.target.closest('.view-details-btn') && 
        !e.target.closest('.course-select') && 
        !e.target.closest('.course-checkbox')
      ) {
        const checkbox = card.querySelector('.course-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          
          // Trigger change event
          const event = new Event('change');
          checkbox.dispatchEvent(event);
        }
      }
    });
  });
  
  // Add specific handler for the checkmark spans
  document.querySelectorAll('.checkmark').forEach(checkmark => {
    checkmark.addEventListener('click', (e) => {
      // Find the associated checkbox
      const checkbox = e.target.closest('.course-select').querySelector('.course-checkbox');
      if (checkbox) {
        // Toggle checkbox
        checkbox.checked = !checkbox.checked;
        
        // Trigger change event
        const event = new Event('change');
        checkbox.dispatchEvent(event);
        
        // Prevent card click from handling this
        e.stopPropagation();
      }
    });
  });
  
  // Ensure the "View Details" buttons don't toggle checkboxes
  document.querySelectorAll('.view-details-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const courseId = button.dataset.courseId;
      viewCourseDetails(courseId);
    });
  });
}

function updateGenerateButton() {
  const generateButtonContainer = document.getElementById('generate-button-container');
  const selectedCourses = getSelectedCourses();
  
  if (!generateButtonContainer) {
    return;
  }
  
  if (selectedCourses.length > 0) {
    generateButtonContainer.style.display = 'block';
    generateButtonContainer.innerHTML = `
      <div class="selected-count">${selectedCourses.length} course${selectedCourses.length === 1 ? '' : 's'} selected</div>
      <button id="generate-curriculum-btn" class="primary-button">
        <span class="material-icons">auto_awesome</span>
        Generate Curriculum
      </button>
    `;
    
    // Add event listener for generate button
    document.getElementById('generate-curriculum-btn')?.addEventListener('click', () => {
      generateCurriculum(selectedCourses);
    });
  } else {
    generateButtonContainer.style.display = 'none';
  }
}

function getSelectedCourses() {
  const selectedCheckboxes = document.querySelectorAll('.course-checkbox:checked:not(#select-all-courses)');
  return Array.from(selectedCheckboxes).map(checkbox => checkbox.dataset.courseId);
}

async function generateCurriculum(courseIds) {
  if (!courseIds || courseIds.length === 0) {
    alert('Please select at least one course to generate a curriculum.');
    return;
  }
  
  const generateButton = document.getElementById('generate-curriculum-btn');
  const generateButtonContainer = document.getElementById('generate-button-container');
  
  if (generateButton) {
    // Show loading state
    generateButton.disabled = true;
    generateButton.innerHTML = `
      <span class="material-icons rotating">sync</span>
      Generating...
    `;
  }
  
  try {
    // Collect course details for selected courses
    const selectedCourses = [];
    for (const courseId of courseIds) {
      try {
        const courseWork = await classroomService.fetchCourseWork(courseId);
        const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`);
        const courseName = courseElement?.querySelector('.course-name')?.textContent || 'Unknown Course';
        
        selectedCourses.push({
          id: courseId,
          name: courseName,
          courseWork: courseWork
        });
      } catch (error) {
        console.error(`Error fetching course work for course ${courseId}:`, error);
      }
    }
    
    // Show success and navigate to the new curriculum view
    showGeneratedCurriculum(selectedCourses);
  } catch (error) {
    console.error('Error generating curriculum:', error);
    alert(`Failed to generate curriculum: ${error.message}`);
    
    if (generateButton) {
      // Reset button state
      generateButton.disabled = false;
      generateButton.innerHTML = `
        <span class="material-icons">auto_awesome</span>
        Generate Curriculum
      `;
    }
  }
}

function showGeneratedCurriculum(courses) {
  // Hide courses container and show curriculum view
  const coursesContainer = document.getElementById('courses-container');
  const generateButtonContainer = document.getElementById('generate-button-container');
  
  if (coursesContainer) {
    coursesContainer.style.display = 'none';
  }
  
  if (generateButtonContainer) {
    generateButtonContainer.style.display = 'none';
  }
  
  // Create curriculum container if it doesn't exist
  let curriculumContainer = document.getElementById('generated-curriculum-container');
  if (!curriculumContainer) {
    curriculumContainer = document.createElement('div');
    curriculumContainer.id = 'generated-curriculum-container';
    curriculumContainer.className = 'generated-curriculum-container';
    
    const curriculumContent = document.getElementById('curriculum-content');
    if (curriculumContent) {
      curriculumContent.appendChild(curriculumContainer);
    }
  }
  
  // Generate curriculum content
  const courseCount = courses.length;
  const totalAssignments = courses.reduce((total, course) => total + (course.courseWork?.length || 0), 0);
  
  curriculumContainer.innerHTML = `
    <div class="curriculum-header">
      <h3>Your Personalized Curriculum</h3>
      <button id="back-to-courses" class="secondary-button">
        <span class="material-icons">arrow_back</span>
        Back to Courses
      </button>
    </div>
    
    <div class="curriculum-summary">
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">school</span></div>
        <div class="summary-count">${courseCount}</div>
        <div class="summary-label">Courses</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">assignment</span></div>
        <div class="summary-count">${totalAssignments}</div>
        <div class="summary-label">Assignments</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon"><span class="material-icons">schedule</span></div>
        <div class="summary-count">${Math.ceil(totalAssignments * 1.5)}</div>
        <div class="summary-label">Est. Hours</div>
      </div>
    </div>
    
    <div class="curriculum-timeline">
      <h4>Study Timeline</h4>
      <div class="timeline-container">
        ${generateTimelineHTML(courses)}
      </div>
    </div>
    
    <div class="curriculum-courses">
      <h4>Course Materials</h4>
      ${courses.map(course => `
        <div class="curriculum-course-card">
          <h5>${course.name}</h5>
          <div class="course-materials">
            ${course.courseWork && course.courseWork.length > 0 
              ? `<ul class="materials-list">
                  ${course.courseWork.map(work => `
                    <li class="material-item">
                      <span class="material-icons">${getWorkTypeIcon(work.workType)}</span>
                      <div class="material-details">
                        <div class="material-title">${work.title}</div>
                        ${work.dueDate ? `<div class="material-due">Due: ${formatDate(work.dueDate)}</div>` : ''}
                      </div>
                    </li>
                  `).join('')}
                </ul>`
              : '<p class="empty-message">No course materials available</p>'
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  // Display the curriculum container
  curriculumContainer.style.display = 'block';
  
  // Add event listener for back button
  document.getElementById('back-to-courses')?.addEventListener('click', () => {
    curriculumContainer.style.display = 'none';
    
    if (coursesContainer) {
      coursesContainer.style.display = 'grid';
    }
    
    updateGenerateButton();
  });
}

function generateTimelineHTML(courses) {
  // Get all assignments with due dates
  const assignmentsWithDates = [];
  
  courses.forEach(course => {
    if (course.courseWork && course.courseWork.length > 0) {
      course.courseWork.forEach(work => {
        if (work.dueDate) {
          assignmentsWithDates.push({
            title: work.title,
            courseName: course.name,
            dueDate: createDateFromDueDate(work.dueDate),
            workType: work.workType || 'ASSIGNMENT'
          });
        }
      });
    }
  });
  
  // Sort assignments by due date
  assignmentsWithDates.sort((a, b) => a.dueDate - b.dueDate);
  
  // Group assignments by week
  const today = new Date();
  const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;
  const weeks = [];
  
  // Create 4 weeks starting from today
  for (let i = 0; i < 4; i++) {
    const startDate = new Date(today.getTime() + (i * weekMilliseconds));
    const endDate = new Date(startDate.getTime() + weekMilliseconds - 1);
    
    weeks.push({
      startDate,
      endDate,
      assignments: []
    });
  }
  
  // Assign each assignment to a week
  assignmentsWithDates.forEach(assignment => {
    for (const week of weeks) {
      if (assignment.dueDate >= week.startDate && assignment.dueDate <= week.endDate) {
        week.assignments.push(assignment);
        break;
      }
    }
  });
  
  // Generate HTML for timeline
  return `
    <div class="timeline">
      ${weeks.map((week, index) => `
        <div class="timeline-week">
          <div class="timeline-week-header">
            <div class="week-number">Week ${index + 1}</div>
            <div class="week-dates">${formatDateShort(week.startDate)} - ${formatDateShort(week.endDate)}</div>
          </div>
          <div class="timeline-assignments">
            ${week.assignments.length > 0 
              ? week.assignments.map(assignment => `
                <div class="timeline-assignment">
                  <div class="assignment-icon">
                    <span class="material-icons">${getWorkTypeIcon(assignment.workType)}</span>
                  </div>
                  <div class="assignment-details">
                    <div class="assignment-title">${assignment.title}</div>
                    <div class="assignment-course">${assignment.courseName}</div>
                    <div class="assignment-due">Due: ${formatDateShort(assignment.dueDate)}</div>
                  </div>
                </div>
              `).join('')
              : '<div class="empty-week">No assignments due this week</div>'
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function createDateFromDueDate(dueDate) {
  return new Date(
    dueDate.year, 
    (dueDate.month || 1) - 1, 
    dueDate.day || 1
  );
}

function formatDateShort(date) {
  return new Intl.DateTimeFormat('en-US', { 
    month: 'short', 
    day: 'numeric' 
  }).format(date);
}

function getWorkTypeIcon(workType) {
  switch (workType) {
    case 'ASSIGNMENT':
      return 'assignment';
    case 'SHORT_ANSWER_QUESTION':
      return 'question_answer';
    case 'MULTIPLE_CHOICE_QUESTION':
      return 'quiz';
    case 'QUIZ':
      return 'quiz';
    case 'TEST':
      return 'fact_check';
    case 'MATERIAL':
      return 'book';
    default:
      return 'assignment';
  }
}

// Helper function to format date
function formatDate(dateObj) {
  if (!dateObj) return 'No due date';
  
  try {
    const date = createDateFromDueDate(dateObj);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric'
    });
  } catch (e) {
    return 'Invalid date';
  }
}

// Updated viewCourseDetails function that properly displays a modal
async function viewCourseDetails(courseId) {
  try {
    // Show loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `
      <span class="material-icons rotating">sync</span>
      <p>Loading course details...</p>
    `;
    document.body.appendChild(loadingIndicator);
    
    // Fetch course work data
    const courseWork = await classroomService.fetchCourseWork(courseId);
    
    // Remove loading indicator
    document.body.removeChild(loadingIndicator);
    
    // Get course name
    const courseElement = document.querySelector(`.course-card[data-course-id="${courseId}"]`);
    const courseName = courseElement?.querySelector('.course-name')?.textContent || 'Course Details';
    
    // Create the modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = `course-details-modal-${courseId}`;
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${courseName}</h2>
          <button class="close-button">&times;</button>
        </div>
        <div class="modal-body">
          <h3>Assignments and Materials</h3>
          <div class="coursework-list">
            ${courseWork.length === 0 ? 
              '<p class="empty-state">No assignments or materials found for this course.</p>' : 
              courseWork.map(item => `
                <div class="coursework-item">
                  <div class="coursework-title">
                    <span class="material-icons">${getWorkTypeIcon(item.workType)}</span>
                    ${item.title}
                  </div>
                  ${item.description ? 
                    `<div class="coursework-description">${item.description}</div>` : ''}
                  <div class="coursework-meta">
                    <span class="coursework-type">${item.workType || 'Assignment'}</span>
                    ${item.dueDate ? 
                      `<span class="coursework-due">Due: ${formatDate(item.dueDate)}</span>` : ''}
                  </div>
                </div>
              `).join('')}
          </div>
        </div>
      </div>
    `;
    
    // Add the modal to the body
    document.body.appendChild(modal);
    
    // Force a reflow before adding the active class (for animation)
    void modal.offsetWidth;
    
    // Show the modal with animation
    setTimeout(() => {
      modal.classList.add('active');
    }, 10);
    
    // Add event listener to close button
    modal.querySelector('.close-button').addEventListener('click', () => {
      closeModal(modal);
    });
    
    // Close modal when clicking outside of content
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
    
    // Add keyboard events for accessibility
    document.addEventListener('keydown', function escKeyHandler(e) {
      if (e.key === 'Escape') {
        closeModal(modal);
        document.removeEventListener('keydown', escKeyHandler);
      }
    });
    
  } catch (error) {
    console.error('Error loading course details:', error);
    
    // Show error in a clean modal
    const errorModal = document.createElement('div');
    errorModal.className = 'modal active';
    errorModal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Error</h2>
          <button class="close-button">&times;</button>
        </div>
        <div class="modal-body">
          <p>Failed to load course details: ${error.message}</p>
          <button class="primary-button" id="retry-course-details">
            <span class="material-icons">refresh</span>
            Retry
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(errorModal);
    
    // Set up event listeners for error modal
    errorModal.querySelector('.close-button').addEventListener('click', () => {
      closeModal(errorModal);
    });
    
    errorModal.querySelector('#retry-course-details')?.addEventListener('click', () => {
      closeModal(errorModal);
      viewCourseDetails(courseId);
    });
    
    errorModal.addEventListener('click', (event) => {
      if (event.target === errorModal) {
        closeModal(errorModal);
      }
    });
  }
}

// Helper function to close modal with animation
function closeModal(modalElement) {
  modalElement.classList.remove('active');
  
  // Wait for animation to complete before removing from DOM
  setTimeout(() => {
    if (document.body.contains(modalElement)) {
      document.body.removeChild(modalElement);
    }
  }, 300); // Match this to your CSS transition duration
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